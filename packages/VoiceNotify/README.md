# VoiceNotify

## What this does

VoiceNotify is a Discord bot that notifies people when a voice chat is taking place.

[You can also directly add the bot here](https://discord.com/oauth2/authorize?client_id=712670038267789352&scope=bot&permissions=150528)

## Setting it up

You MUST run this with environment variables, or alternatively use a `.env` file as follows. Firebase Realtime Database is used to store channel data, fill the `FIREBASE` properties accordingly :

```
VOICENOTIFY_DISCORD_TOKEN=your_discord_token
VOICENOTIFY_FIREBASE_CLIENT_EMAIL=your_firebase_client_email
VOICENOTIFY_FIREBASE_PRIVATE_KEY='your_firebase_private_key'
VOICENOTIFY_FIREBASE_PROJECT_ID=your_firebase_project_id
VOICENOTIFY_FIREBASE_DATABASE_URL=your_firebase_database_url
```

Then install the bot with `yarn install` & start it with `yarn start`
You might want to use a process manager such as PM2 to keep the bot running

## Using the bot

Bot commands to enable & disable voice chat notifications (administrators only) :

`@VoiceNotify enable [threshold] [roles]`
Enables voice chat notifications for the voice channel you are in, alerts will be sent to the channel where this command is executed.

Optional : [threshold] to trigger an alert defaults to 5 people ; [roles] will be mentioned when the alert is sent.

`@VoiceNotify disable`
Disables voice chat notifications for the voice channel you are in.

## Debugging

Users can use the command `@VoiceNotify debug` to display useful informations for debugging purposes. Set the `WEBHOOK` environment variables to receive Discord notifications if exceptions arise :

```
VOICENOTIFY_WEBHOOK_ID=your_webhook_id
VOICENOTIFY_WEBHOOK_TOKEN=your_webhook_token
```
