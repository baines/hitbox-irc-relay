# hitbox-irc-relay
experimental hitbox chat / irc protocol translation relay

# How to use it?
Run it in the background on your computer with node, if it complains about
any missing modules then you can get them with `npm install`

Connect to localhost:5555 in your irc client using your hitbox username + password.

If everything goes well you'll be connected and see a welcome message in your
irc client, you can now do /join \#*channel* as usual to join the chat of the
hitbox channel *channel*.

# What works?
* sending / receiving channel messages
* /kick
* seeing people who get kicked
* /topic
* userlist sort of works - but doesn't update very well currently
* notices about slow / sub mode

# What doesn't work (yet)?
* join / part messages
* whispers / direct messages
* joining multiple channels at once might be a bit broken
* /ban, /kickban
* /me

Feel free to fork it or send pull requests etc.
