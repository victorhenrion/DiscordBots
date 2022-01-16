/* eslint-disable eqeqeq */

import 'dotenv/config'

import { Client, WebhookClient, MessageAttachment, MessageEmbed } from 'discord.js'
import { get, request } from 'https'

import { convert } from './convert.js'
import info from './package.json'
const client = new Client()
const hook = new WebhookClient(process.env.MAKEPDF_WEBHOOK_ID, process.env.MAKEPDF_WEBHOOK_TOKEN)

const log = (msg) => {
  console.log(msg)
  hook.send(new MessageEmbed().setDescription(msg).setTitle('MakePDF – Debug').setColor('#ED4539')).catch(() => {})
}
const lastRestart = Date.now()

client.on('message', async (msg) => {
  const { author, attachments, channel } = msg
  const { mentions, guild, member, content } = msg //required by debug command

  if (author.id == client.user.id) return

  if (content.includes('debug'))
    if (
      channel.type == 'dm' ||
      (mentions?.has(guild?.me, { ignoreEveryone: true }) && member?.hasPermission('ADMINISTRATOR'))
    )
      return msg.reply(
        new MessageEmbed().setTitle('MakePDF – Debug').setColor('#ED4539').setDescription(`
          **version :** MakePDF v${info.version}
          **time :** ${Date.now()}
          **lastRestart :** ${lastRestart}
          **guildId :** ${msg.guild?.id}
          **memberId :** ${author.id}
          **channelId :** ${channel.id}
        `)
      )

  const filesArray = attachments.array()

  filesArray.length > 0 &&
    filesArray.forEach(({ name, url }) => {
      if (!url) return

      const formats = process.env.MAKEPDF_SETTINGS_FORMATS.split(',')
      const extension = name.substring(name.lastIndexOf('.') + 1)

      if (!formats.includes(extension)) return

      get(url, (res) => {
        const bufs = []
        res.on('data', (chunk) => bufs.push(chunk))
        res.on('error', (err) => {
          channel.send(`Sorry, the conversion has failed :cry:`)
          return log(`Error during HTTP request : ${err.message}`)
        })
        res.on('end', () => {
          const fileData = Buffer.concat(bufs)

          convert(fileData, '.pdf', undefined, (err, pdfData) => {
            if (err) {
              channel.send(`Sorry, the conversion has failed :cry:`)
              return log(`Error converting file : ${err}`)
            }

            const newName = name.substring(0, name.lastIndexOf('.')) + '.pdf'
            const newAttachment = new MessageAttachment(pdfData, newName)
            channel.send(`**:paperclip: Here is your converted PDF file :**`, newAttachment)
          })
        })
      })
    })
})

client.on('ready', () => {
  log(`Bot (re)started, version ${info.version}`)
})

client.on('guildCreate', () => client.user.setActivity(`${client.guilds.cache.size} servers ⚡`, { type: 'WATCHING' }))
client.on('guildDelete', () => client.user.setActivity(`${client.guilds.cache.size} servers ⚡`, { type: 'WATCHING' }))

client.on('shardError', (e) => log(`Websocket connection error: ${e}`))
process.on(
  'unhandledRejection', //@ts-ignore
  (e) => e.code != 50013 && e.code != 50001 && log(`Unhandled promise rejection:\n\n${e.stack}\n\n${JSON.stringify(e)}`)
)

client.login(process.env.MAKEPDF_DISCORD_TOKEN)
