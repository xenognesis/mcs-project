import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder
} from 'discord.js';
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
  /** Canal de Discord usado para avisos y para detectar el servidor (guild). */
  channelId?: string;
  /** ID del servidor (guild). Si no se indica, se detecta a partir del canal. */
  guildId?: string;
  /** Carpeta compartida del servidor; de acá se deriva la ruta del tracker. */
  driveRoot?: string;
  /** Ruta explícita al data.json del mod tracker-mod. */
  trackerDataPath?: string;
  /** Jugadores conocidos, para vincular ID de Discord -> nombre de Minecraft. */
  players?: Player[];
  onCommand: (command: string) => void;
  onLog: (line: string) => void;
};

type TrackerCoord = {
  name?: string;
  x?: number;
  y?: number;
  z?: number;
  dimension?: string;
  privateEntry?: boolean;
  createdBy?: string;
};

type TrackerTodo = {
  text?: string;
  done?: boolean;
  privateEntry?: boolean;
  createdBy?: string;
};

type TrackerData = { coords: TrackerCoord[]; todos: TrackerTodo[] };

/** Lee el data.json del mod tracker-mod. Acepta coords/todos como array u objeto. */
export function readTrackerData(dataPath: string): TrackerData {
  const parsed = JSON.parse(readFileSync(dataPath, 'utf8')) as {
    coords?: TrackerCoord[] | Record<string, TrackerCoord>;
    todos?: TrackerTodo[] | Record<string, TrackerTodo>;
  };
  const coords = Array.isArray(parsed.coords) ? parsed.coords : Object.values(parsed.coords ?? {});
  const todos = Array.isArray(parsed.todos) ? parsed.todos : Object.values(parsed.todos ?? {});
  return { coords, todos };
}

const samePlayer = (a?: string, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

export const visibleCoords = (coords: TrackerCoord[], mcName: string | null) =>
  coords.filter((coord) => !coord.privateEntry || samePlayer(coord.createdBy, mcName));

export const visibleTodos = (todos: TrackerTodo[], mcName: string | null) =>
  todos.filter((todo) => !todo.privateEntry || samePlayer(todo.createdBy, mcName));

/** Arma uno o más embeds, partiendo listas largas en trozos por debajo del límite de Discord. */
function buildEmbeds(title: string, lines: string[], color: number): EmbedBuilder[] {
  const embeds: EmbedBuilder[] = [];
  const limit = 3900;
  let chunk = '';
  const push = () => {
    if (chunk) {
      embeds.push(new EmbedBuilder().setTitle(title).setColor(color).setDescription(chunk));
      chunk = '';
    }
  };
  for (const line of lines) {
    if ((chunk + '\n' + line).length > limit) push();
    chunk = chunk ? chunk + '\n' + line : line;
  }
  push();
  if (embeds.length === 0) {
    embeds.push(new EmbedBuilder().setTitle(title).setColor(color).setDescription('_(vacío)_'));
  }
  return embeds.slice(0, 10);
}

function coordEmbeds(data: TrackerData, mcName: string | null): EmbedBuilder[] {
  const visible = visibleCoords(data.coords, mcName);
  const lines = visible.map((coord) =>
    `• **${coord.name ?? '?'}** — ${coord.x} ${coord.y} ${coord.z} [${coord.dimension ?? '?'}]${coord.privateEntry ? ' 🔒' : ''}`
  );
  return buildEmbeds(`Coordenadas (${visible.length})`, lines, 0xf1c40f);
}

function todoEmbeds(data: TrackerData, mcName: string | null): EmbedBuilder[] {
  const visible = visibleTodos(data.todos, mcName);
  const lines = visible.map((todo, index) =>
    `${index + 1}. ${todo.done ? '☑' : '☐'} ${todo.text ?? ''}${todo.privateEntry ? ' 🔒' : ''}`
  );
  return buildEmbeds(`Tareas (${visible.length})`, lines, 0x2ecc71);
}

const trackerCommands = [
  new SlashCommandBuilder().setName('coords').setDescription('Muestra las coordenadas guardadas en el tracker'),
  new SlashCommandBuilder().setName('todos').setDescription('Muestra la lista de tareas del tracker'),
  new SlashCommandBuilder().setName('tracker').setDescription('Muestra coordenadas y tareas del tracker')
].map((command) => command.toJSON());

export async function startDiscordBot(options: DiscordBotOptions): Promise<void> {
  const { token, adminDiscordId, channelId, guildId, driveRoot, players, onCommand, onLog } = options;
  if (!token) return;

  const trackerDataPath = options.trackerDataPath
    || (driveRoot ? path.join(driveRoot, 'config', 'tracker-mod', 'data.json') : '');

  if (activeClient) {
    try { activeClient.destroy(); } catch { /* ignore */ }
    activeClient = null;
  }

  const playerByDiscordId = new Map(
    (players ?? []).filter((player) => player.discordId).map((player) => [player.discordId, player.name])
  );
  const mcNameFor = (discordId: string) => playerByDiscordId.get(discordId) ?? null;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
  });

  const resolveGuildId = async (): Promise<string | null> => {
    if (guildId) return guildId;
    if (!channelId) return null;
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && 'guildId' in channel) return (channel as { guildId?: string }).guildId ?? null;
      return null;
    } catch {
      return null;
    }
  };

  client.once('clientReady', async () => {
    onLog(`Bot de Discord conectado como ${client.user?.tag ?? 'desconocido'}.`);
    if (!trackerDataPath) {
      onLog('[Discord] Sin carpeta de Drive configurada: no se registran los comandos /coords, /todos ni /tracker.');
      return;
    }
    try {
      const resolvedGuild = await resolveGuildId();
      if (!resolvedGuild) {
        onLog('[Discord] No pude detectar el servidor de Discord. Configurá "ID Canal Discord" o "ID del servidor".');
        return;
      }
      const rest = new REST({ version: '10' }).setToken(token);
      await rest.put(Routes.applicationGuildCommands(client.user!.id, resolvedGuild), { body: trackerCommands });
      onLog('[Discord] Comandos /coords, /todos y /tracker registrados.');
    } catch (error) {
      onLog(`[Discord] No se pudieron registrar los comandos: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const commandName = interaction.commandName;
    try {
      const mcName = mcNameFor(interaction.user.id);
      let data: TrackerData;
      try {
        data = readTrackerData(trackerDataPath);
      } catch (error) {
        await interaction.reply({
          content: `No pude leer el archivo del tracker:\n\`${error instanceof Error ? error.message : String(error)}\`\nRuta: \`${trackerDataPath}\``,
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (commandName === 'coords') {
        await interaction.reply({ embeds: coordEmbeds(data, mcName), flags: MessageFlags.Ephemeral });
        return;
      }
      if (commandName === 'todos') {
        await interaction.reply({ embeds: todoEmbeds(data, mcName), flags: MessageFlags.Ephemeral });
        return;
      }
      if (commandName === 'tracker') {
        await interaction.reply({ embeds: coordEmbeds(data, mcName), flags: MessageFlags.Ephemeral });
        await interaction.followUp({ embeds: todoEmbeds(data, mcName), flags: MessageFlags.Ephemeral });
      }
    } catch (error) {
      onLog(`Error procesando el comando /${commandName}: ${error instanceof Error ? error.message : String(error)}`);
    }
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
