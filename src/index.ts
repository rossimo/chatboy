import 'dotenv/config';
import * as fs from 'fs';
import * as tmp from 'tmp';
import * as path from 'path';
import * as glob from 'glob';
import { first, range, toLower } from 'lodash';
import * as shelljs from 'shelljs';
import { ActionRowBuilder, Attachment, AttachmentBuilder, ButtonBuilder, ButtonStyle, CacheType, Client, EmbedBuilder, GatewayIntentBits, Interaction, TextChannel } from 'discord.js';

import { encodeFrames } from './encode';
import { arraysEqual } from './image';
import { ControllerState, execute, executeAndRecord, initWasmBoy, loadRom, loadState, saveState } from './wasm';

const EXPORT_FPS = 15;
const MAX_EMULATION_SECONDS = 60;
const IDLE_EMULATION_SECONDS = 8;

const INPUTS: ControllerState[] = [
    { START: true },
    { SELECT: true },
    { B: true },
    { A: true },
    { B: true },
    { UP: true },
    { RIGHT: true },
    { DOWN: true },
    { LEFT: true }
];

tmp.setGracefulCleanup();

const parseInput = (input: string) => {
    switch (toLower(input)) {
        case 'a':
            return { A: true };
        case 'b':
            return { B: true };
        case 'up':
            return { UP: true };
        case 'down':
            return { DOWN: true };
        case 'left':
            return { LEFT: true };
        case 'right':
            return { RIGHT: true };
        case 'select':
            return { SELECT: true };
        case 'start':
            return { START: true };
    }
}

const main = async () => {
    const args = process.argv.slice(2);

    let playerInputs = args.map(arg => parseInput(arg))

    const romFile: string = first(glob.sync('roms/*.gb'));
    const saveFile = path.join('saves', path.basename(`${romFile}.sav`));

    if (!romFile) {
        throw new Error('No ROM file');
    }

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    await client.login(process.env.DISCORD_TOKEN);
    const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID) as TextChannel;
    console.log('online');

    const { wasmboy, wasmboyMemory } = await initWasmBoy();

    const rom = new Uint8Array(fs.readFileSync(romFile));
    loadRom(wasmboy, wasmboyMemory, rom);

    wasmboy.config(0, 1, 1, 0, 0, 0, 1, 0, 0, 0);

    if (fs.existsSync(saveFile)) {
        const state = JSON.parse(fs.readFileSync(saveFile).toString());

        loadState(wasmboy, wasmboyMemory, state);
    }

    wasmboy.executeMultipleFrames(1);

    while (true) {
        const start = new Date();
        console.log(`Emulating...`);

        const recordInterval = Math.round(60 / EXPORT_FPS);
        const { name: framesDir } = tmp.dirSync();

        let recordedFrames = 0;
        let totalFrames = 0;

        for (const playerInput of playerInputs) {
            const inputResult = await executeAndRecord(wasmboy, wasmboyMemory, playerInput, 4, totalFrames, framesDir, recordInterval, recordedFrames);
            recordedFrames = inputResult.recordedFrames;
            totalFrames = inputResult.totalFrames;

            if (playerInputs.length > 1) {
                const waitResult = await executeAndRecord(wasmboy, wasmboyMemory, {}, 26, totalFrames, framesDir, recordInterval, recordedFrames);
                recordedFrames = waitResult.recordedFrames;
                totalFrames = waitResult.totalFrames;
            }
        }

        playerInputs = [];

        /*
        let latestIdle
        test: for (let i = 0; i < 60 * MAX_EMULATION_SECONDS; i = i + 60) {
            const waitControlResult = await executeAndRecord(wasmboy, wasmboyMemory, {}, 56, totalFrames, framesDir, recordInterval, recordedFrames);
            recordedFrames = waitControlResult.recordedFrames;
            totalFrames = waitControlResult.totalFrames;

            latestIdle = saveState(wasmboy, wasmboyMemory);

            const controlResult = await execute(wasmboy, wasmboyMemory, {}, 4);
            for (const input of INPUTS) {
                const test = await initWasmBoy();
                loadRom(test.wasmboy, test.wasmboyMemory, rom);
                test.wasmboy.config(0, 1, 1, 0, 0, 0, 1, 0, 0, 0);
                await loadState(test.wasmboy, test.wasmboyMemory, latestIdle);

                const testResult = await execute(test.wasmboy, test.wasmboyMemory, input, 4);

                if (!arraysEqual(controlResult.frame, testResult.frame)) {
                    break test;
                }
            }
        }

        await loadState(wasmboy, wasmboyMemory, latestIdle);
        */

        const waitResult = await executeAndRecord(wasmboy, wasmboyMemory, {}, 60 * IDLE_EMULATION_SECONDS, totalFrames, framesDir, recordInterval, recordedFrames);
        recordedFrames = waitResult.recordedFrames;
        totalFrames = waitResult.totalFrames;

        shelljs.mkdir('-p', 'saves');
        fs.writeFileSync(saveFile, JSON.stringify(saveState(wasmboy, wasmboyMemory)));

        console.log(`Encoding...`);
        await encodeFrames(framesDir, 60 / recordInterval);

        const end = new Date();
        console.log(`${(end.getTime() - start.getTime()) / 1000}s`)

        console.log(`Sending...`);


        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('a')
                    .setEmoji('🇦')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('b')
                    .setEmoji('🇧')
                    .setStyle(ButtonStyle.Secondary)
            )

        const directions = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('up')
                    .setEmoji('⬆️')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('down')
                    .setEmoji('⬇️')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('left')
                    .setEmoji('⬅️')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('Right')
                    .setEmoji('➡️')
                    .setStyle(ButtonStyle.Secondary)
            );

        const menus = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('select')
                    .setLabel('Select')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('start')
                    .setLabel('Start')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('5')
                    .setLabel('5')
                    .setStyle(ButtonStyle.Secondary)
            );

        await channel.send({
            files: [{
                attachment: path.resolve(path.join('output', 'outputfile.gif'))
            }],
            components: [buttons as any, directions as any, menus as any]
        });


        console.log(`Waiting...`);
        let multiplier = 1;
        while (true) {
            const interaction = await new Promise<Interaction<CacheType>>((res, rej) => {
                client.once('interactionCreate', res);
            });

            if (interaction.isButton()) {
                if (isNumeric(interaction.customId)) {
                    multiplier = parseInt(interaction.customId);
                    interaction.update({});
                } else {
                    playerInputs = range(0, multiplier).map(() => parseInput(interaction.customId));
                    interaction.update({});
                    break;
                }
            }
        }
    }

    client.destroy();
}

const isNumeric = (value) => {
    return /^\d+$/.test(value);
};

main().catch(err => {
    console.error(err);
    process.exit(-1);
})
