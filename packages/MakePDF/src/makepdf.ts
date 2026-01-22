import assert from 'node:assert'
import { ActivityType, AttachmentBuilder, ChannelType, Client, DiscordjsError, EmbedBuilder, WebhookClient } from 'discord.js'
import info from '../package.json' with { type: 'json' }
import { convert } from './convert.ts'

const env = new Proxy(process.env, {
  get(target, key: string) {
    return target[`MAKEPDF_${key}`] || undefined
  },
})

const { DISCORD_TOKEN, SETTINGS_FORMATS, WEBHOOK_ID, WEBHOOK_TOKEN, TOPGG_ID, TOPGG_TOKEN } = env

assert(DISCORD_TOKEN, 'MAKEPDF_DISCORD_TOKEN is required')
assert(SETTINGS_FORMATS, 'MAKEPDF_SETTINGS_FORMATS is required')
if (!WEBHOOK_ID) console.warn('MAKEPDF_WEBHOOK_ID is not set')
if (!WEBHOOK_TOKEN) console.warn('MAKEPDF_WEBHOOK_TOKEN is not set')
if (!TOPGG_ID) console.warn('MAKEPDF_TOPGG_ID is not set')
if (!TOPGG_TOKEN) console.warn('MAKEPDF_TOPGG_TOKEN is not set')

const lastRestart = Date.now()

const versionText = `MakePDF v${info.version}`
const environment = `${process.env.HEROKU_APP_NAME ?? 'local'} (${process.env.HEROKU_SLUG_DESCRIPTION ?? '…'})`

const client = new Client({
  intents: [],
})

const webhook = (WEBHOOK_ID && WEBHOOK_TOKEN)
  ? new WebhookClient({ id: WEBHOOK_ID, token: WEBHOOK_TOKEN })
  : null

const log = (msg: string) => {
  console.log(msg)
  if (webhook) {
    const embed = new EmbedBuilder()
      .setDescription(msg)
      .setTitle('MakePDF – Debug')
      .setColor('#ED4539')
    webhook.send({ embeds: [embed] }).catch(() => {})
  }
}

client.on('messageCreate', async (msg) => {
  const { author, attachments, channel } = msg
  const { mentions, guild, member, content } = msg // required by debug command

  if (author.id === client.user?.id) return

  if (content.includes('debug')) {
    if (
      channel.type === ChannelType.DM
      || (guild?.members.me && mentions?.has(guild?.members.me, { ignoreEveryone: true }) && member?.permissions.has('Administrator'))
    ) {
      return msg.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('MakePDF – Debug')
            .setColor('#ED4539')
            .setDescription(`
            **version :** ${versionText}
            **environment :** ${environment}
            **time :** ${Date.now()}
            **lastRestart :** ${lastRestart}
            **guildId :** ${msg.guild?.id}
            **memberId :** ${author.id}
            **channelId :** ${channel.id}
            `),
        ],
      })
    }
  }

  if (!attachments.size) return

  await Promise.all(attachments.map(async ({ name, url }) => {
    if (!url) return

    const formats = SETTINGS_FORMATS!.split(',')
    const extension = name.substring(name.lastIndexOf('.') + 1)

    if (!formats.includes(extension)) return

    const res = await fetch(url)
    const fileData = await res.arrayBuffer()
    convert(fileData, '.pdf', (err, pdfData) => {
      if (err || !pdfData) {
        channel.send({ content: `\`😢\` Sorry, the conversion **has failed**` })
        return log(`Error converting file : ${err}`)
      }

      const newName = name.substring(0, name.lastIndexOf('.')) + '.pdf'
      const newAttachment = new AttachmentBuilder(Buffer.from(pdfData), { name: newName })
      channel.send({ content: `\`📎\` Here is your converted **PDF file**:`, files: [newAttachment] })
    })
  }))
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

client.on('guildDelete', () => {
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
