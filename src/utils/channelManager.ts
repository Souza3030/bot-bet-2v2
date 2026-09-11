import {
  ChannelType,
  Guild,
  OverwriteResolvable,
  PermissionsBitField,
} from "discord.js";
import { QueueMode, Team } from "../types";
import { config } from "../config";

interface CreatedMatchChannels {
  categoryId: string;
  textChannelId: string;
  voiceChannelAId: string;
  voiceChannelBId: string;
}

/**
 * Cria a categoria temporária de uma partida, contendo:
 * - 1 canal de texto para o chat/registro de resultado
 * - 1 canal de voz para o Time A
 * - 1 canal de voz para o Time B
 *
 * Apenas os jogadores sorteados (e a Staff, implicitamente via permissões
 * padrão do servidor) têm acesso aos canais.
 */
export async function createMatchChannels(
  guild: Guild,
  mode: QueueMode,
  matchId: string,
  teamA: Team,
  teamB: Team
): Promise<CreatedMatchChannels> {
  const allMemberIds = [...teamA.memberIds, ...teamB.memberIds];

  const baseOverwrites: OverwriteResolvable[] = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    ...allMemberIds.map((id) => ({
      id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.Connect,
        PermissionsBitField.Flags.Speak,
        PermissionsBitField.Flags.SendMessages,
      ],
    })),
  ];

  const category = await guild.channels.create({
    name: `partida-${mode}-${matchId}`,
    type: ChannelType.GuildCategory,
    permissionOverwrites: baseOverwrites,
  });

  const textChannel = await guild.channels.create({
    name: `📋-resultado-${matchId}`,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: baseOverwrites,
  });

  const voiceChannelA = await guild.channels.create({
    name: `🔊 Time A - ${matchId}`,
    type: ChannelType.GuildVoice,
    parent: category.id,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      ...teamA.memberIds.map((id) => ({
        id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.Speak,
        ],
      })),
    ],
  });

  const voiceChannelB = await guild.channels.create({
    name: `🔊 Time B - ${matchId}`,
    type: ChannelType.GuildVoice,
    parent: category.id,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      ...teamB.memberIds.map((id) => ({
        id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.Speak,
        ],
      })),
    ],
  });

  return {
    categoryId: category.id,
    textChannelId: textChannel.id,
    voiceChannelAId: voiceChannelA.id,
    voiceChannelBId: voiceChannelB.id,
  };
}

/**
 * Apaga a categoria e todos os canais filhos de uma partida encerrada.
 */
export async function deleteMatchChannels(
  guild: Guild,
  channels: CreatedMatchChannels
): Promise<void> {
  const idsToDelete = [
    channels.textChannelId,
    channels.voiceChannelAId,
    channels.voiceChannelBId,
    channels.categoryId, // categoria é apagada por último
  ];

  for (const id of idsToDelete) {
    const channel = guild.channels.cache.get(id);
    if (channel) {
      await channel.delete().catch((err) => {
        console.error(`[ChannelManager] Falha ao deletar canal ${id}:`, err);
      });
    }
  }
}

/**
 * Rotina de limpeza automática de categorias/canais de partida órfãos.
 *
 * Identifica categorias cujo nome comece com o prefixo configurado
 * (ex: "partida-") e que tenham sido criadas há mais tempo do que o
 * limite configurado (`config.cleanup.staleMatchChannelMaxAgeMs`),
 * removendo-as junto com todos os seus canais filhos.
 *
 * Isso funciona de forma independente do estado em memória
 * (`activeMatches`), servindo como uma rede de segurança contra canais
 * que ficaram órfãos por reinício do bot, falhas não tratadas, ou
 * qualquer outro cenário em que a exclusão automática não ocorreu.
 *
 * @returns Quantidade de categorias órfãs removidas.
 */
export async function cleanupStaleMatchChannels(guild: Guild): Promise<number> {
  const now = Date.now();
  const { staleMatchChannelMaxAgeMs, matchCategoryPrefix } = config.cleanup;

  const staleCategories = guild.channels.cache.filter(
    (channel) =>
      channel.type === ChannelType.GuildCategory &&
      channel.name.startsWith(matchCategoryPrefix) &&
      channel.createdTimestamp !== null &&
      now - channel.createdTimestamp >= staleMatchChannelMaxAgeMs
  );

  let removedCount = 0;

  for (const category of staleCategories.values()) {
    try {
      const childChannels = guild.channels.cache.filter(
        (c) => "parentId" in c && c.parentId === category.id
      );

      for (const child of childChannels.values()) {
        await child.delete().catch((err) => {
          console.error(`[ChannelManager] Falha ao deletar canal órfão ${child.id}:`, err);
        });
      }

      await category.delete();
      removedCount += 1;
      console.log(`[ChannelManager] Categoria órfã removida: ${category.name} (${category.id})`);
    } catch (err) {
      console.error(`[ChannelManager] Falha ao remover categoria órfã ${category.id}:`, err);
    }
  }

  return removedCount;
}

/**
 * Inicia a rotina periódica de limpeza de canais órfãos para uma guild.
 * Deve ser chamada uma única vez, na inicialização do bot.
 */
export function startOrphanChannelCleanup(guild: Guild): void {
  setInterval(() => {
    cleanupStaleMatchChannels(guild).catch((err) => {
      console.error("[ChannelManager] Erro na rotina de limpeza automática:", err);
    });
  }, config.cleanup.cleanupIntervalMs);
}
