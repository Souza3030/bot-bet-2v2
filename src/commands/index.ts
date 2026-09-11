import { ChatInputCommandInteraction, SharedSlashCommand } from "discord.js";
import * as painelFilas from "./painelFilas";

export interface Command {
  data: SharedSlashCommand;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export const commands: Command[] = [painelFilas];
