import { REST, Routes } from "discord.js";
import { config } from "./config";
import { commands } from "./commands";

async function deploy() {
  const body = commands.map((command) => command.data.toJSON());
  const rest = new REST({ version: "10" }).setToken(config.discord.token);

  console.log(`[Deploy] Registrando ${body.length} comando(s) slash...`);

  await rest.put(
    Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
    { body }
  );

  console.log("[Deploy] Comandos registrados com sucesso.");
}

deploy().catch((err) => {
  console.error("[Deploy] Falha ao registrar comandos:", err);
  process.exit(1);
});
