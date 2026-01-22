# MakePDF

## What this does

MakePDF is a Discord bot that automatically converts word processing, spreadsheet and presentation documents to PDF.

[You can also directly add the bot here](https://discord.com/oauth2/authorize?client_id=932278614911766599&scope=bot&permissions=52224)

## Setting it up

Install LibreOffice using either the installer, or the following command

```
sudo apt-get install libreoffice-core --no-install-recommends
```

You MUST run this with environment variables, or alternatively use a `.env` file as follows. Set the desired formats allowed for conversion with the `MAKEPDF_SETTINGS_FORMATS` property :

```
MAKEPDF_DISCORD_TOKEN=your_discord_token
MAKEPDF_SETTINGS_FORMATS=doc,docx,odt,rtf,ppt,pps,pptx,ppsx,odp,xls,xlsx,ods,csv
```

Then install the bot with `yarn install` & start it with `yarn start`
You might want to use a process manager such as PM2 to keep the bot running

## Using the bot

Simply add MakePDF to your server. It will automatically convert all supported files to PDF, in all the channels it has access to.

## Debugging

Users can use the command `@MakePDF debug` to display useful informations for debugging purposes. Set the `WEBHOOK` environment variables to receive Discord notifications if exceptions arise :

```
MAKEPDF_WEBHOOK_ID=your_webhook_id
MAKEPDF_WEBHOOK_TOKEN=your_webhook_token
```
