// Updates only this application's entry point; preserves all other commands.
const id = process.env.DISCORD_CLIENT_ID;
const token = process.env.DISCORD_BOT_TOKEN;
if (!id || !token) throw new Error('Set DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN in .env first.');
const base = `https://discord.com/api/v10/applications/${id}/commands`;
const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' };
const existing = await fetch(base, { headers });
if (!existing.ok) throw new Error(`Could not read commands (HTTP ${existing.status}).`);
const commands = await existing.json() as { id: string; type: number }[];
const entry = commands.find((command) => command.type === 4);
const response = await fetch(entry ? `${base}/${entry.id}` : base, {
  method: entry ? 'PATCH' : 'POST', headers,
  body: JSON.stringify({ name: 'launch', description: 'Play ti-jeux together with one host driving.', type: 4, handler: 1 }),
});
if (!response.ok) throw new Error(`Could not register the Activity launch command (HTTP ${response.status}). Enable Activities in the developer portal first.`);
console.log('ti-jeux entry point registered with APP_HANDLER. Set the Interactions Endpoint URL to https://YOUR_HOST/api/interactions.');
