import { execFile } from 'node:child_process'
import { access, readFile, writeFile } from 'node:fs'
import { join } from 'node:path'
import async from 'async'
import { dirSync } from 'tmp'

export const convert = (
  document: ArrayBuffer,
  format: `.${string}`,
  callback: (error: Error | null, result: ArrayBuffer | null) => void,
) => {
  const tempDir = dirSync({
    prefix: 'libreofficeConvert_',
    unsafeCleanup: true,
  })

  const installDir = dirSync({
    prefix: 'soffice',
    unsafeCleanup: true,
  })
  return async.auto(
    {
      soffice: (callback) => {
        let paths = []
        switch (process.platform) {
          case 'darwin':
            paths = ['/Applications/LibreOffice.app/Contents/MacOS/soffice']
            break
          case 'linux':
            paths = [
              (process.env.OFFICE_PATH || '/opt/libreoffice').replace('opt', 'usr/bin'),
              '/usr/bin/libreoffice',
              '/usr/bin/soffice',
              '/snap/bin/libreoffice',
            ]
            break
          case 'win32':
            paths = [
              join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'LIBREO~1/program/soffice.exe'),
              join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'LibreOffice/program/soffice.exe'),
              join(process.env.PROGRAMFILES || 'C:\\Program Files', 'LibreOffice/program/soffice.exe'),
            ]
            break
          default:
            return callback(new Error(`Operating system not yet supported: ${process.platform}`))
        }

        return async.filter(
          paths,
          (filePath, callback) => access(filePath, (err) => callback(null, !err)),
          (err, res) => {
            if (err || !res || res.length === 0) {
              return callback(new Error('Could not find soffice binary'), null)
            }

            return callback(null, res[0])
          },
        )
      },
      saveSource: (callback) => writeFile(join(tempDir.name, 'source'), Buffer.from(document), callback),
      convert: [
        'soffice',
        'saveSource',
        (results: any, callback) => {
          let command = `-env:UserInstallation=file://${installDir.name} --headless --convert-to ${format}`
          command += ` --outdir ${tempDir.name} ${join(tempDir.name, 'source')}`
          const args = command.split(' ')
          return execFile(results.soffice, args, callback)
        },
      ],
      loadDestination: [
        'convert',
        (_results, callback) =>
          async.retry(
            {
              times: 3,
              interval: 200,
            },
            (callback) => readFile(join(tempDir.name, `source.${format.split(':')[0]}`), callback),
            callback,
          ),
      ],
    },
    (err, res) => {
      tempDir.removeCallback()
      installDir.removeCallback()

      if (err) {
        return callback(err, null)
      }

      if (!res) {
        return callback(new Error('No result from conversion'), null)
      }

      return callback(null, res.loadDestination)
    },
  )
}
