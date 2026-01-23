import assert from 'node:assert'
import dayjs from 'dayjs'
import { ActivityType, Client, DiscordjsError, EmbedBuilder, MessageMentions, WebhookClient } from 'discord.js'
import { cert, initializeApp } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'
import info from '../package.json' with { type: 'json' }

const env = new Proxy(process.env, {
  get(target, key: string) {
    return target[`VOICENOTIFY_${key}`] || undefined
  },
})

// dprint-ignore
const { DISCORD_TOKEN, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_PROJECT_ID, FIREBASE_DATABASE_URL, WEBHOOK_ID, WEBHOOK_TOKEN, TOPGG_ID, TOPGG_TOKEN } = env

assert(DISCORD_TOKEN, 'VOICENOTIFY_DISCORD_TOKEN is required')
assert(FIREBASE_CLIENT_EMAIL, 'VOICENOTIFY_FIREBASE_CLIENT_EMAIL is required')
assert(FIREBASE_PRIVATE_KEY, 'VOICENOTIFY_FIREBASE_PRIVATE_KEY is required')
assert(FIREBASE_PROJECT_ID, 'VOICENOTIFY_FIREBASE_PROJECT_ID is required')
assert(FIREBASE_DATABASE_URL, 'VOICENOTIFY_FIREBASE_DATABASE_URL is required')
if (!WEBHOOK_ID) console.warn('VOICENOTIFY_WEBHOOK_ID is not set')
if (!WEBHOOK_TOKEN) console.warn('VOICENOTIFY_WEBHOOK_TOKEN is not set')
if (!TOPGG_ID) console.warn('VOICENOTIFY_TOPGG_ID is not set')
if (!TOPGG_TOKEN) console.warn('VOICENOTIFY_TOPGG_TOKEN is not set')

const lastRestart = Date.now()

const versionText = `VoiceNotify v${info.version}`
const environment = `${process.env.HEROKU_APP_NAME ?? 'local'} (${process.env.HEROKU_SLUG_DESCRIPTION ?? '…'})`

const client = new Client({
  intents: ['Guilds', 'GuildVoiceStates', 'GuildMessages'],
})

const webhook = (WEBHOOK_ID && WEBHOOK_TOKEN)
  ? new WebhookClient({ id: WEBHOOK_ID, token: WEBHOOK_TOKEN })
  : null

const log = (msg: string) => {
  console.log(msg)
  if (webhook) {
    const embed = new EmbedBuilder()
      .setDescription(msg)
      .setTitle('VoiceNotify – Debug')
      .setColor('#08C754')
    webhook.send({ embeds: [embed] }).catch(() => {})
  }
}

initializeApp({
  credential: cert({
    clientEmail: FIREBASE_CLIENT_EMAIL,
    privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    projectId: FIREBASE_PROJECT_ID,
  }),
  databaseURL: FIREBASE_DATABASE_URL,
})

const db = getDatabase()

interface Settings {
  text: string
  min: number
  roles?: string[] | null
}

const thresholdTimes = new Map<string, number>() // last threshold time per channel
const broadcastTimes = new Map<string, number>() // last broadcast time per channel
const lastDonationAsked = new Map<string, number>() // last donation message time per guild

// settings management
const cache = new Map<string, Map<string, Settings>>()
const manager = {
  get: async (guildId: string): Promise<Map<string, Settings>> => {
    if (cache.has(guildId)) return cache.get(guildId)!

    const snapshot = await db.ref(guildId).once('value').catch(() => null)
    const val = snapshot?.val()
    const settingsMap = new Map<string, Settings>(
      Object.entries((val && typeof val === 'object') ? val : {}),
    )
    cache.set(guildId, settingsMap)
    return settingsMap
  },

  set: async (guildId: string, channelId: string, value: Settings): Promise<void> => {
    await db.ref(guildId).child(channelId).set(value)
    const guildCache = cache.get(guildId) ?? cache.set(guildId, new Map()).get(guildId)!
    guildCache.set(channelId, value)
  },

  deleteChannel: async (guildId: string, channelId: string): Promise<void> => {
    await db.ref(guildId).child(channelId).remove()
    cache.get(guildId)?.delete(channelId)
  },

  deleteGuild: async (guildId: string): Promise<void> => {
    await db.ref(guildId).remove()
    cache.delete(guildId)
  },
}

client.on('voiceStateUpdate', async ({ channel: oldChannel }, { channel, guild }) => {
  // exit if user is leaving a channel
  if (!channel) return

  // exit if user changing mute/listen status
  if (channel.id === oldChannel?.id) return

  // fetch channel settings from db
  const settings = (await manager.get(guild.id)).get(channel.id)
  if (!settings) return

  // get text channel or delete if unreachable (deleted channel)
  const textChannel = await guild.channels.fetch(settings.text)
    .then((channel) => {
      if (!channel) log(`Text channel "${settings.text}" unreachable`)
      return channel
    })
    .catch((error) => {
      if (error instanceof DiscordjsError) log(`Text channel "${settings.text}" unreachable, ${error.code}: ${error.message}`)
      else log(`Text channel "${settings.text}" unreachable, ${error}`)
      return null
    })

  if (!textChannel) return

  // exit if threshold is not reached
  if (channel.members.size < settings.min) return

  // get and set last threshold
  const lastThreshold = thresholdTimes.get(channel.id)
  thresholdTimes.set(channel.id, Date.now())

  // exit if threshold already reached recently
  // (progressive antispam depending on set threshold: 1p = 5m, 2p = 2.5m, 5p = 1m, 10p = 30s...)
  if (lastThreshold && Date.now() - lastThreshold < (5 / settings.min) * 60 * 1000) return

  // get last broadcast and exit if already sent <10m ago
  const lastBroadcast = broadcastTimes.get(channel.id)
  if (lastBroadcast && Date.now() - lastBroadcast < 10 * 60 * 1000) return

  // set last broadcast
  broadcastTimes.set(channel.id, Date.now())

  // send message
  if (textChannel.isTextBased()) {
    const embed = new EmbedBuilder()
      .setColor('#08C754')
      .setTitle(`A voice chat is taking place in \`${channel.name}\` !`)
    if (settings.roles?.length) {
      embed.addFields({ name: '', value: `CC: ${settings.roles.join(' ')}` })
    }
    if (!lastDonationAsked.has(guild.id) || dayjs().diff(lastDonationAsked.get(guild.id)!, 'hours') > 24) {
      embed.addFields({ name: '', value: `*VoiceNotify can't run without your support. [Donate](https://victor.id/donate)*` })
      lastDonationAsked.set(guild.id, Date.now())
    }
    textChannel.send({ embeds: [embed] })
  }
})

client.on('messageCreate', async (msg) => {
  const { member, guild, mentions, content, channel } = msg

  const senderId = member?.id
  const botId = guild?.members.me?.id
  if (!senderId || !botId) return

  // message must mention VoiceNotify
  if (!mentions.has(botId, { ignoreEveryone: true })) return
  // sender must not be VoiceNotify
  if (senderId === botId) return
  // sender must be an administrator
  if (!member.permissions.has('Administrator')) {
    return msg.reply('you must be an administrator to use this bot.')
  }

  const [, command, ...params] = content.toLowerCase().split(/ +/g)

  switch (command) {
    case 'enable': {
      if (!member.voice.channel) return msg.reply('you must be in a voice channel to use this command.')

      const min = params[0] && /^\d+$/.test(params[0]) ? Number(params[0]) : 5
      const roles = params.filter((p) => MessageMentions.RolesPattern.test(p)) ?? []

      const settings = { text: channel.id, min, roles }
      await manager.set(guild.id, member.voice.channel.id, settings)
      return msg.reply(
        `when ${settings.min} people or more are connected to "${member.voice.channel.name}",`
          + `we will send an alert in <#${channel.id}> mentioning ${settings.roles?.length ?? 0} role(s).`,
      )
    }

    case 'disable': {
      if (!member.voice.channel) return msg.reply('you must be in a voice channel to use this command.')

      await manager.deleteChannel(guild.id, member.voice.channel.id)
      return msg.reply(`notifications have been disabled for "${member.voice.channel.name}".`)
    }

    case 'debug': {
      const embed = new EmbedBuilder()
        .setTitle('VoiceNotify – Debug')
        .setColor('#08C754')
        .setDescription(`
        **version :** ${versionText}
        **environment :** ${environment}
        **time :** ${Date.now()}
        **lastRestart :** ${lastRestart}
        **guildId :** ${guild.id}
        **memberId :** ${member.id}
        **textChannelId :** ${channel.id}
        **voiceChannelId :** ${member.voice?.channelId}
        ${member.voice.channelId ? `**lastThreshold :** ${thresholdTimes.get(member.voice.channelId)}` : ''}
        ${member.voice.channelId ? `**lastBroadcast :** ${broadcastTimes.get(member.voice.channelId)}` : ''}
        **guildSettings :**\n\`\`\`${JSON.stringify(Object.fromEntries(await manager.get(guild.id)))}\`\`\`
        `)
      msg.reply({ embeds: [embed] })
      // reset last threshold and broadcast times
      if (member.voice.channelId) {
        thresholdTimes.delete(member.voice.channelId)
        broadcastTimes.delete(member.voice.channelId)
      }
      return
    }

    default: {
      return msg.reply(`
here are the bot commande to enable & disable voice chat notifications (administrators only) :

\`@VoiceNotify enable [threshold] [roles]\`
Enables voice chat notifications for the voice channel you are in, alerts will be sent to the channel where this command is executed.
Optional : [threshold] to trigger an alert defaults to 5 people ; [roles] will be mentioned when the alert is sent.

\`@VoiceNotify disable\`
Disables voice chat notifications for the voice channel you are in.
      `)
    }
  }
})

const updateGuildCount = async (server_count: number) => {
  // update discord activity
  client.user?.setActivity(`${server_count} servers ⚡`, { type: ActivityType.Watching })
  // update top.gg
  try {
    if (!TOPGG_TOKEN) return
    await fetch(`https://top.gg/api/bots/${TOPGG_ID}/stats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': TOPGG_TOKEN,
      },
      body: JSON.stringify({ server_count }),
    })
  } catch {}
}

client.on('ready', () => {
  log(`${versionText} (re)started on ${environment}`)
  updateGuildCount(client.guilds.cache.size)
})

client.on('guildCreate', () => {
  updateGuildCount(client.guilds.cache.size)
})

client.on('guildDelete', (guild) => {
  manager.deleteGuild(guild.id)
  updateGuildCount(client.guilds.cache.size)
})

client.on('shardError', (error) => {
  log(`Websocket connection error: ${error}`)
})

process.on('unhandledRejection', (error) => {
  if (error instanceof DiscordjsError) {
    // if (e.code !== 50013 && e.code !== 50001) return
  }
  log(`Unhandled promise rejection:\n\n${error}`)
})

client.login(DISCORD_TOKEN)
