import { Client, Intents, MessageEmbed, MessageMentions, Permissions, WebhookClient } from 'discord.js'
import { cert, initializeApp } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'
import { request } from 'https'

import info from '../package.json' assert { type: 'json' }

const versionText = `VoiceNotify v${info.version}`
const environment = `${process.env.HEROKU_APP_NAME ?? 'local'} (${process.env.HEROKU_SLUG_DESCRIPTION ?? '…'})`

const client = new Client({
  intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_VOICE_STATES, Intents.FLAGS.GUILD_MESSAGES],
})
const hook = new WebhookClient({
  id: process.env.VOICENOTIFY_WEBHOOK_ID,
  token: process.env.VOICENOTIFY_WEBHOOK_TOKEN,
})

const log = (msg) => {
  console.log(msg)
  hook
    .send({
      embeds: [new MessageEmbed().setDescription(msg).setTitle('VoiceNotify – Debug').setColor('#08C754')],
    })
    .catch(() => {})
}

initializeApp({
  credential: cert({
    clientEmail: process.env.VOICENOTIFY_FIREBASE_CLIENT_EMAIL,
    privateKey: JSON.parse(`"${process.env.VOICENOTIFY_FIREBASE_PRIVATE_KEY}"`),
    projectId: process.env.VOICENOTIFY_FIREBASE_PROJECT_ID,
  }),
  databaseURL: process.env.VOICENOTIFY_FIREBASE_DATABASE_URL,
})
const db = getDatabase()
const lastRestart = Date.now()

const thresholdTimes = new Map() // last threshold time per channel
const broadcastTimes = new Map() // last broadcast time per channel

// settings management
const manager = {
  cache: {},
  get: async (g, c) => (c ? (await manager.get(g))?.[c] : (manager.cache[g] ||= (await db.ref(g).once('value')).val())),
  set: async (g, c, s) =>
    s
    && (await db
      .ref(g)
      .child(c)
      .set(s)
      .then(async () => (await manager.get(g)) && (manager.cache[g][c] = s))),
  del: async (g, c) =>
    c
      ? await db
        .ref(g)
        .child(c)
        .remove()
        .then(() => delete manager.cache[g]?.[c])
      : await db
        .ref(g)
        .remove()
        .then(() => delete manager.cache[g]),
}

client.on('voiceStateUpdate', async ({ channel: oldChannel }, { channel, guild }) => {
  // exit if user is leaving a channel
  if (!channel) return

  // exit if user changing mute/listen status
  if (channel.id == oldChannel?.id) return

  // fetch channel settings from db
  const settings = await manager.get(guild.id, channel.id)
  if (!settings) return

  // get text channel or delete if unreachable (deleted channel)
  let textChannel
  try {
    textChannel = await guild.channels.fetch(settings.text)
  } catch (e) {
    return log(`Text channel "${settings.text}" unreachable. (${e.code}: ${e.message})`)
    // return manager.del(guild.id, channel.id)
  }

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

  // get potential roles to mention
  const rolesList = settings.roles || ''

  // send message
  textChannel.send(`\`🎙️\` A voice chat is taking place in "**${channel.name}**"!\n${rolesList}`)
})

client.on('messageCreate', async (msg) => {
  const { member, guild, mentions, content, channel } = msg

  if (!member || member.id == guild.me.id) return
  if (!mentions?.has(guild.me, { ignoreEveryone: true })) return
  if (!member.permissions.has(Permissions.FLAGS.ADMINISTRATOR)) {
    return msg.reply('you must be an administrator to use this bot.')
  }

  const [, command, ...params] = content.toLowerCase().split(/ +/g)

  switch (command) {
    case 'enable' || 'disable':
      if (!member.voice.channelId) return msg.reply('you must be in a voice channel to use this bot.')

    case 'enable':
      const settings = {
        text: channel.id,
        min: Number(/^\d+$/.test(params[0]) ? params[0] : '5'),
        roles: params?.toString().match(MessageMentions.ROLES_PATTERN),
      }
      await manager.set(guild.id, member.voice.channelId, settings)
      return msg.reply(
        `when ${settings.min} people or more are connected to "${member.voice.channel.name}", we will send an alert in <#${channel.id}> mentioning ${
          settings.roles?.length || '0'
        } role(s).`,
      )

    case 'disable':
      await manager.del(guild.id, member.voice.channelId)
      return msg.reply(`notifications have been disabled for "${member.voice.channel.name}".`)

    case 'debug':
      msg.reply({
        embeds: [
          new MessageEmbed()
            .setTitle('VoiceNotify – Debug')
            .setColor('#08C754')
            .setDescription(
              `
              **version :** ${versionText}
              **environment :** ${environment}
              **time :** ${Date.now()}
              **lastRestart :** ${lastRestart}
              **guildId :** ${guild.id}
              **memberId :** ${member.id}
              **textChannelId :** ${channel.id}
              **voiceChannelId :** ${member.voice?.channelId}
              **lastThreshold :** ${thresholdTimes.get(member.voice?.channelId)}
              **lastBroadcast :** ${broadcastTimes.get(member.voice?.channelId)}
              **guildSettings :**\n\`\`\`${JSON.stringify(await manager.get(guild.id))}\`\`\`
              `,
            ),
        ],
      })
      thresholdTimes.set(member.voice?.channelId, undefined)
      broadcastTimes.set(member.voice?.channelId, undefined)
      return

    default:
      return msg.reply(`
here are the bot commande to enable & disable voice chat notifications (administrators only) :

\`@VoiceNotify enable [threshold] [roles]\`
Enables voice chat notifications for the voice channel you are in, alerts will be sent to the channel where this command is executed.
Optional : [threshold] to trigger an alert defaults to 5 people ; [roles] will be mentioned when the alert is sent.

\`@VoiceNotify disable\`
Disables voice chat notifications for the voice channel you are in.
      `)
  }
})

const updateGuildCount = (server_count) => {
  client.user.setActivity(`${server_count} servers ⚡`, { type: 'WATCHING' })
  try {
    process.env.VOICENOTIFY_TOPGG_TOKEN
      && request({
        hostname: 'top.gg',
        port: 443,
        path: `/api/bots/${process.env.VOICENOTIFY_BOT_ID}/stats`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `${process.env.VOICENOTIFY_TOPGG_TOKEN}`,
        },
      }).end(
        JSON.stringify({
          server_count,
        }),
      )
  } catch (_e) {}
}

client.on('ready', () => {
  log(`${versionText} (re)started on ${environment}`)
  updateGuildCount(client.guilds.cache.size)
})
client.on('guildCreate', () => updateGuildCount(client.guilds.cache.size))
client.on('guildDelete', ({ id }) => {
  manager.del(id)
  updateGuildCount(client.guilds.cache.size)
})

client.on('shardError', (e) => log(`Websocket connection error: ${e}`))
process.on(
  'unhandledRejection',
  (e) => e.code != 50013 && e.code != 50001 && log(`Unhandled promise rejection:\n\n${e.stack}\n\n${JSON.stringify(e)}`),
)

client.login(process.env.VOICENOTIFY_DISCORD_TOKEN)
