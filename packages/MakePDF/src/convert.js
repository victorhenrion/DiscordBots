import async from 'async'
import { execFile } from 'child_process'
import { access, readFile, writeFile } from 'fs'
import { join } from 'path'
import { dirSync } from 'tmp'

const convertWithOptions = (document, format, filter, options, callback) => {
  const tmpOptions = (options || {}).tmpOptions || {}
  const asyncOptions = (options || {}).asyncOptions || {}
  const tempDir = dirSync({
    prefix: 'libreofficeConvert_',
    unsafeCleanup: true,
    ...tmpOptions,
  })
  const installDir = dirSync({
    prefix: 'soffice',
    unsafeCleanup: true,
    ...tmpOptions,
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
              process.env.OFFICE_PATH.replace('opt', 'usr/bin'),
              '/usr/bin/libreoffice',
              '/usr/bin/soffice',
              '/snap/bin/libreoffice',
            ]
            break
          case 'win32':
            paths = [
              join(process.env['PROGRAMFILES(X86)'], 'LIBREO~1/program/soffice.exe'),
              join(process.env['PROGRAMFILES(X86)'], 'LibreOffice/program/soffice.exe'),
              join(process.env.PROGRAMFILES, 'LibreOffice/program/soffice.exe'),
            ]
            break
          default:
            return callback(new Error(`Operating system not yet supported: ${process.platform}`))
        }

        return async.filter(
          paths,
          (filePath, callback) => access(filePath, (err) => callback(null, !err)),
          (err, res) => {
            if (err || res.length === 0) {
              return callback(new Error('Could not find soffice binary'))
            }

            return callback(null, res[0])
          },
        )
      },
      saveSource: (callback) => writeFile(join(tempDir.name, 'source'), document, callback),
      convert: [
        'soffice',
        'saveSource',
        (results, callback) => {
          let command = `-env:UserInstallation=file://${installDir.name} --headless --convert-to ${format}`
          if (filter !== undefined) {
            command += `:"${filter}"`
          }
          command += ` --outdir ${tempDir.name} ${join(tempDir.name, 'source')}`
          const args = command.split(' ')
          return execFile(results.soffice, args, callback)
        },
      ],
      loadDestination: [
        'convert',
        (results, callback) =>
          async.retry(
            {
              times: asyncOptions.times || 3,
              interval: asyncOptions.interval || 200,
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
        return callback(err)
      }

      return callback(null, res.loadDestination)
    },
  )
}

const convert = (document, format, filter, callback) => {
  return convertWithOptions(document, format, filter, {}, callback)
}

export { convert, convertWithOptions }
