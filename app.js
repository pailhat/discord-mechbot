const { CommentStream, SubmissionStream } = require("snoostorm");
const Snoowrap = require('snoowrap');
const Snoostorm = require('snoostorm');
const Discord = require("discord.js");
const { Client } = require("pg");
require('dotenv').config();

const splitTitle = function (title) {
    let hasIdx = title.indexOf("[H]");
    let wantsIdx = title.indexOf("[W]");
    let origin = "";
    let has = "";
    let wants = "";

    if (hasIdx > wantsIdx) {
        has = title.substring(hasIdx);
        if (wantsIdx > -1) {
            origin = title.substring(0, wantsIdx);
            wants = title.substring(wantsIdx, hasIdx);
        } else {
            origin = title.substring(0, hasIdx);
        }
    } else if (wantsIdx > hasIdx) {
        wants = title.substring(wantsIdx);
        if (hasIdx > -1) {
            origin = title.substring(0, hasIdx);
            has = title.substring(hasIdx, wantsIdx);
        } else {
            origin = title.substring(0, wantsIdx);
        }
    }
    return { origin, has, wants };
}

const client = new Client({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DB_NAME,
    password: process.env.PG_PW,
    port: process.env.PG_PORT,
});

client.connect();

const query = `
SELECT *
FROM mechbot_alert
WHERE enabled=true
`;

const bot = new Discord.Client();

const r = new Snoowrap({
    userAgent: 'mech-notifier',
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    username: process.env.REDDIT_USER,
    password: process.env.REDDIT_PASS
});

const submissions = new SubmissionStream(r, {
    subreddit: "MechMarket",
    limit: 10,
    pollTime: 2000,
});

let submission_counter = 0;
let ignore_count = 10;

bot.on("ready", async () => {
    bot.user.setStatus("available");
    bot.user.setPresence({
        game: {
            name: "Yoo",
        },
    });
    console.log("This discord bot is online!");



    //Start listening for reddit only stuff after bot logged in.
    submissions.on("item", async (post) => {
        // Don't resend old recent posts everytime we restart the bot, since SnooStorm gets the amount specified in "limit" in SubmissionStream all at once on startup
        if (submission_counter < ignore_count) {
            submission_counter++;
            return;
        }

        let post_title = (await post).title;
        console.log("POST: " + post_title);
        let split = splitTitle(post_title);
        console.log(split);
        let post_origin = split.origin;
        let post_has = split.has;
        let post_wants = split.wants;

        if (post_has == "" && post_wants == "") {
            console.log(post_title);
            console.log("Not a Buying/Selling/Trading post.");
            return;
        }
        // Post it to the mechmarket feed channel
        bot.channels.cache.get(process.env.MM_FEED_CHANNEL_ID).send(post_title + "\n" + post.url + "\n<@&" + process.env.MM_FEED_ROLE_ID + ">");

        client.query(query, async (err, res) => {
            if (err) {
                console.log("Error: ");
                console.error(err);
                return;
            }
            for (let row of res.rows) {
                try {
                    //The bot will only message you if you're in a common server and have DMs turned on for server members
                    const user = await bot.users.fetch(row.user_id_id);


                    let alert_origin = row.origin ? row.origin : "";
                    let alert_has = row.has ? row.has : "";
                    let alert_wants = row.wants ? row.wants : "";
                    if (post_origin.includes(alert_origin) && post_has.toLowerCase().includes(alert_has.toLowerCase()) && post_wants.toLowerCase().includes(alert_wants.toLowerCase())) {
                        let message = "**Origin:** " + (alert_origin == "" ? "*Any*" : alert_origin) + " **[H]** " + (alert_has == "" ? "*Any*" : alert_has) + " **[W]** " + (alert_wants == "" ? "*Any*" : alert_wants) + "\n\n" + post_title + '\n' + post.url + '\n';
                        user.send(message);
                        console.log("SENT MESSAGE TO: " + user.username + "#" + user.discriminator);
                        console.log(message);
                    }

                }
                catch (e) {
                    console.log("Unable to message user " + row.user_id_id + " for alert " + row.id);
                    console.log(e);
                }

            }
        });

    });
});

// When someone joins the server:
// - Assign them an unverified role that blocks them from seeing the server. Verify that they registered on the site with discord 
//   and remove the blocker role if they are. (Server join requrements should be restrictive so I don't get ddosed from someone spam joining new accounts)
// - Try to DM them, if it works then set the can_dm flag to true
bot.on("guildMemberAdd", async (member) => {
    // Assign unregistered role so that people that join the server are actually registered for the thing
    let query = "SELECT COUNT(*) as count from mechbot_discorduser where id = " + member.user.id;
    client.query(query, async (err, res) => {
        if (res.rows.pop().count == 0) {
            // User has not signed up so give them the unregistered role. They will only be able to see the welcome channel.
            member.roles.add("793344574226825216");
            console.log("New member is not registered yet...!")
            // Try to create a DM channel
            try {
                member.user.send("Welcome! \n\nLink your discord account to me at https://mechbot.panamahat.dev to set up and begin recieving alerts.");
            } catch (e) {
                console.log('Failed to send message to unregistered user.');
                // Warn the user with a ping in the warnings channel
                
            }
        } else {
            // If they've signed up give them the registered role.
            member.roles.add("793354360893341717");
            console.log("New member is registered")
            // Try to create a DM channel
            try {
                member.user.send("You're all set to recieve alerts! Set them up at https://mechbot.staging.panamahat.dev/alerts");
                // Update can_dm to True for this user so they don't receive that notification
                let updateQuery = "UPDATE mechbot_discorduser SET can_dm = true WHERE id = " + member.user.id;
                client.query(updateQuery, async (err, res) => {
                    console.log("Updated can_dm flag to 'true' in DB for " + member.user.username + "#" + member.user.discriminator)
                });
            } catch (e) {
                console.log("Failed to send message to registered user.");
                // Warn user with a ping in the warnings channel
                
            }
        }
    });
});

// When someone leaves the server set the can_dm flag to false
bot.on("guildMemberRemove", (member) => {
    console.log("Guilde Member Left: ");
    console.log(member.user.username);
});


// When someone updates their username or avatar, update it in the DB too
bot.on("userUpdate", (oldUser, newUser) => {
    //When a user updates their username we need to update their username too
    console.log("USER UPDATE");
    console.log("OLD: ");
    console.log(oldUser);
    console.log("NEW:");
    console.log(newUser);
});

bot.login(process.env.DISCORD_TOKEN);

