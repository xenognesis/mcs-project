import type { Player } from './types';

export async function notifyPlayers(token: string, players: Player[], message: string) {
  if (!token || !players.length) return;
  await Promise.allSettled(players.filter((player) => player.discordId).map(async (player) => {
    const dm = await fetch('https://discord.com/api/v10/users/@me/channels', { method: 'POST', headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient_id: player.discordId }) });
    if (!dm.ok) throw new Error(`No se pudo crear DM para ${player.name}`);
    const channel = await dm.json() as { id: string };
    const sent = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, { method: 'POST', headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ content: message }) });
    if (!sent.ok) throw new Error(`No se pudo enviar DM para ${player.name}`);
  }));
}
