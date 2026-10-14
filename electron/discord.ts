import { Client, GatewayIntentBits, Partials } from 'discord.js';
import type { Player } from './types';

let activeClient: Client | null = null;

export async function notifyPlayers(token: string, players: Player[], message: string, channelId?: string) {
  if (!token) return;
  if (channelId) {
    const sent = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message })
    });
    if (!sent.ok) throw new Error(`No se pudo enviar mensaje al canal ${channelId}`);
    return;
  }
  if (!players.length) return;
  await Promise.allSettled(players.filter((player) => player.discordId).map(async (player) => {
    const dm = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: player.discordId })
    });
    if (!dm.ok) throw new Error(`No se pudo crear DM para ${player.name}`);
    const channel = await dm.json() as { id: string };
    const sent = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message })
    });
    if (!sent.ok) throw new Error(`No se pudo enviar DM para ${player.name}`);
  }));
}

export type DiscordBotOptions = {
  token: string;
  adminDiscordId?: string;
  onCommand: (command: string) => void;
  onLog: (line: string) => void;
};

export async function startDiscordBot(options: DiscordBotOptions): Promise<void> {
  const { token, adminDiscordId, onCommand, onLog } = options;
  if (!token) return;
  if (activeClient) {
    try { activeClient.destroy(); } catch { /* ignore */ }
    activeClient = null;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
  });

  client.once('ready', () => {
    onLog(`Bot de Discord conectado como ${client.user?.tag ?? 'desconocido'}.`);
  });

  client.on('error', (err) => {
    onLog(`Error en el bot de Discord: ${err.message}`);
  });

  client.on('messageCreate', async (message) => {
    try {
      if (message.author.bot) return;

      const trimmed = message.content.trim();
      if (!trimmed.startsWith('!cmd')) return;

      // Solo el administrador autorizado puede ejecutar comandos
      if (!adminDiscordId || message.author.id !== adminDiscordId) {
        onLog(`[Seguridad] Intento no autorizado de comando Discord por ${message.author.tag} (${message.author.id}).`);
        return;
      }

      if (trimmed === '!cmd') {
        await message.reply('ℹ️ Uso: `!cmd <comando>` (ej: `!cmd op TuNombre`)');
        return;
      }

      const rawCmd = trimmed.slice(4).trim();
      const command = rawCmd.startsWith('/') ? rawCmd.slice(1).trim() : rawCmd;

      if (!command) {
        await message.reply('ℹ️ Debes ingresar un comando después de `!cmd`.');
        return;
      }

      onLog(`[Discord Admin @${message.author.tag}] > ${command}`);
      onCommand(command);
      await message.reply(`✅ Comando ejecutado en el servidor: \`${command}\``);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Error al procesar comando';
      onLog(`Error procesando mensaje de Discord: ${msg}`);
    }
  });

  activeClient = client;

  try {
    await client.login(token);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    onLog(`No se pudo iniciar el bot de Discord: ${errorMsg}`);
  }
}

export function stopDiscordBot(): void {
  if (activeClient) {
    try { activeClient.destroy(); } catch { /* ignore */ }
    activeClient = null;
  }
}
