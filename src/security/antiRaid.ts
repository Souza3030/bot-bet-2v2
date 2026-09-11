import {
  ChannelType,
  Client,
  Events,
  Guild,
  GuildMember,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";

const GUILD_ID = process.env.DISCORD_GUILD_ID?.trim() ?? "";
const STAFF_CHANNEL_ID = process.env.STAFF_CHANNEL_ID?.trim() ?? "";

// Ajuste estes valores somente se quiser mudar a sensibilidade do anti-raid.
const JOIN_THRESHOLD = 8;
const JOIN_WINDOW_MS = 20_000;
const RAID_MODE_MS = 10 * 60_000;
const LOCKDOWN_MS = 3 * 60_000;
const MIN_ACCOUNT_AGE_MS = 3 * 24 * 60 * 60_000;
const QUARANTINE_ROLE_NAME = "🚨 Quarentena";

const joins = new Map<string, number[]>();
const raidUntil = new Map<string, number>();
const lockdownUntil = new Map<string, number>();
const trustedUsers = new Set(
  (process.env.ANTI_RAID_TRUSTED_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);
const trustedRoles = new Set(
  (process.env.ANTI_RAID_TRUSTED_ROLE_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

function isTargetGuild(guild: Guild): boolean {
  return Boolean(GUILD_ID) && guild.id === GUILD_ID;
}

function isTrusted(member: GuildMember): boolean {
  return (
    trustedUsers.has(member.id) ||
    member.roles.cache.some((role) => trustedRoles.has(role.id))
  );
}

function accountIsNew(member: GuildMember): boolean {
  return Date.now() - member.user.createdTimestamp < MIN_ACCOUNT_AGE_MS;
}

function registerJoin(guildId: string): number {
  const now = Date.now();
  const recent = (joins.get(guildId) ?? []).filter(
    (timestamp) => now - timestamp <= JOIN_WINDOW_MS
  );
  recent.push(now);
  joins.set(guildId, recent);
  return recent.length;
}

function raidIsActive(guildId: string): boolean {
  const until = raidUntil.get(guildId) ?? 0;
  if (until <= Date.now()) {
    raidUntil.delete(guildId);
    return false;
  }
  return true;
}

async function getOrCreateQuarantineRole(guild: Guild) {
  const configuredId = process.env.ANTI_RAID_QUARANTINE_ROLE_ID?.trim();
  if (configuredId) {
    const configured = await guild.roles.fetch(configuredId).catch(() => null);
    if (configured) return configured;
  }

  const existing = guild.roles.cache.find(
    (role) => role.name === QUARANTINE_ROLE_NAME
  );
  if (existing) return existing;

  return guild.roles.create({
    name: QUARANTINE_ROLE_NAME,
    permissions: [],
    reason: "Anti-raid: role de quarentena",
  });
}

async function configureQuarantineRole(guild: Guild, roleId: string) {
  for (const channel of guild.channels.cache.values()) {
    if (
      channel.type !== ChannelType.GuildText &&
      channel.type !== ChannelType.GuildAnnouncement &&
      channel.type !== ChannelType.GuildForum &&
      channel.type !== ChannelType.GuildVoice &&
      channel.type !== ChannelType.GuildStageVoice
    ) {
      continue;
    }

    if (channel.id === STAFF_CHANNEL_ID) continue;

    await channel.permissionOverwrites
      .edit(
        roleId,
        {
          ViewChannel: true,
          SendMessages: false,
          AddReactions: false,
          CreatePublicThreads: false,
          CreatePrivateThreads: false,
          SendMessagesInThreads: false,
          Connect: false,
          Speak: false,
        },
        { reason: "Anti-raid: isolamento da role de quarentena" }
      )
      .catch((error) => {
        console.error(`[AntiRaid] Falha no canal ${channel.id}:`, error);
      });
  }
}

async function quarantine(member: GuildMember, reason: string) {
  if (isTrusted(member)) return;

  const role = await getOrCreateQuarantineRole(member.guild);
  await configureQuarantineRole(member.guild, role.id);

  if (!member.roles.cache.has(role.id)) {
    await member.roles.add(role, `Anti-raid: ${reason}`).catch((error) => {
      console.error(`[AntiRaid] Não foi possível isolar ${member.id}:`, error);
    });
  }

  // Timeout é uma camada adicional; a role de quarentena é a principal barreira.
  await member.timeout(5 * 60_000, `Anti-raid: ${reason}`).catch(() => undefined);
}

async function sendStaffAlert(guild: Guild, content: string) {
  if (!STAFF_CHANNEL_ID) return;

  const channel = await guild.channels.fetch(STAFF_CHANNEL_ID).catch(() => null);
  if (!channel || !(channel instanceof TextChannel)) return;

  await channel
    .send({
      content,
      allowedMentions: { parse: [] },
    })
    .catch((error) => {
      console.error("[AntiRaid] Falha ao enviar alerta:", error);
    });
}

async function enableLockdown(guild: Guild) {
  if ((lockdownUntil.get(guild.id) ?? 0) > Date.now()) return;

  lockdownUntil.set(guild.id, Date.now() + LOCKDOWN_MS);

  for (const channel of guild.channels.cache.values()) {
    if (
      channel.type !== ChannelType.GuildText &&
      channel.type !== ChannelType.GuildAnnouncement &&
      channel.type !== ChannelType.GuildForum
    ) {
      continue;
    }

    if (channel.id === STAFF_CHANNEL_ID) continue;

    await channel.permissionOverwrites
      .edit(
        guild.roles.everyone,
        {
          SendMessages: false,
          AddReactions: false,
          CreatePublicThreads: false,
          CreatePrivateThreads: false,
        },
        { reason: "Anti-raid: lockdown automático" }
      )
      .catch((error) => {
        console.error(`[AntiRaid] Falha no lockdown ${channel.id}:`, error);
      });
  }

  await sendStaffAlert(
    guild,
    `🚨 **ANTI-RAID: LOCKDOWN ATIVADO**\n` +
      `Foram detectadas ${JOIN_THRESHOLD}+ entradas em ${JOIN_WINDOW_MS / 1000}s.\n` +
      `Novos membros serão colocados em quarentena. O lockdown dura ${LOCKDOWN_MS / 60000} minutos.`
  );

  setTimeout(() => {
    if ((lockdownUntil.get(guild.id) ?? 0) <= Date.now()) {
      lockdownUntil.delete(guild.id);
      // Não tenta reconstruir permissões aqui: isso evita sobrescrever configurações
      // existentes do servidor. O administrador pode remover o lockdown manualmente
      // ou ajustar os overwrites criados pelo anti-raid.
      sendStaffAlert(guild, "✅ **ANTI-RAID:** período de lockdown encerrado.").catch(() => undefined);
    }
  }, LOCKDOWN_MS + 250);
}

export function registerAntiRaid(client: Client): void {
  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      if (!isTargetGuild(member.guild) || isTrusted(member)) return;

      const count = registerJoin(member.guild.id);
      const currentlyRaid = raidIsActive(member.guild.id);

      if (count >= JOIN_THRESHOLD && !currentlyRaid) {
        raidUntil.set(member.guild.id, Date.now() + RAID_MODE_MS);
        await enableLockdown(member.guild);
        await sendStaffAlert(
          member.guild,
          `⚠️ **Possível raid detectada.** ${count} entradas em ${JOIN_WINDOW_MS / 1000}s.`
        );
      }

      if (currentlyRaid || accountIsNew(member)) {
        await quarantine(
          member,
          currentlyRaid ? "entrada durante possível raid" : "conta com menos de 3 dias"
        );

        await sendStaffAlert(
          member.guild,
          `🛡️ **Membro isolado:** <@${member.id}>\n` +
            `Motivo: ${currentlyRaid ? "possível raid" : "conta nova"}`
        );
      }
    } catch (error) {
      console.error("[AntiRaid] Erro ao processar entrada:", error);
    }
  });
}

export async function isMemberQuarantined(member: GuildMember): Promise<boolean> {
  const role = await getOrCreateQuarantineRole(member.guild);
  return member.roles.cache.has(role.id);
}
