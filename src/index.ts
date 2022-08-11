import 'dotenv/config';
import * as fs from 'fs';
import * as tmp from 'tmp';
import * as path from 'path';
import * as glob from 'glob';
import * as shelljs from 'shelljs';
import { first, range, toLower } from 'lodash';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, CacheType, Client, GatewayIntentBits, Interaction, TextChannel, Message, ButtonInteraction } from 'discord.js';

import { encodeFrames } from './encode';
import { ControllerState, execute, executeAndRecord, initWasmBoy, loadRom, loadState, saveState } from './wasm';
import { arraysEqual } from './image';

const EXPORT_FPS = 15;
const MAX_DETECT_IDLE_SECONDS = 7;
const EXTRA_IDLE_SECONDS = 3;

const INPUTS: ControllerState[] = [
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

    let { wasmboy, wasmboyMemory } = await initWasmBoy();

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

            const waitResult = await executeAndRecord(wasmboy, wasmboyMemory, {}, 26, totalFrames, framesDir, recordInterval, recordedFrames);
            recordedFrames = waitResult.recordedFrames;
            totalFrames = waitResult.totalFrames;
        }

        playerInputs = [];

        let state;
        test: for (let i = 0; i < 60 * MAX_DETECT_IDLE_SECONDS; i = i + 60 * 2) {
            const waitControlResult = await executeAndRecord(wasmboy, wasmboyMemory, {}, 26, totalFrames, framesDir, recordInterval, recordedFrames);
            recordedFrames = waitControlResult.recordedFrames;
            totalFrames = waitControlResult.totalFrames;

            state = saveState(wasmboy, wasmboyMemory);

            const controlResult = await execute(wasmboy, wasmboyMemory, {}, 4);
            for (const input of INPUTS) {
                const test = await initWasmBoy();
                loadRom(test.wasmboy, test.wasmboyMemory, rom);
                test.wasmboy.config(0, 1, 1, 0, 0, 0, 1, 0, 0, 0);
                await loadState(test.wasmboy, test.wasmboyMemory, state);

                const testResult = await execute(test.wasmboy, test.wasmboyMemory, input, 4);

                if (!arraysEqual(controlResult.frame, testResult.frame)) {
                    break test;
                }
            }
        }

        if (state) {
            ({ wasmboy, wasmboyMemory } = await initWasmBoy());
            loadRom(wasmboy, wasmboyMemory, rom);
            wasmboy.config(0, 1, 1, 0, 0, 0, 1, 0, 0, 0);
            await loadState(wasmboy, wasmboyMemory, state);
        }

        const waitResult = await executeAndRecord(wasmboy, wasmboyMemory, {}, 60 * EXTRA_IDLE_SECONDS, totalFrames, framesDir, recordInterval, recordedFrames);
        recordedFrames = waitResult.recordedFrames;
        totalFrames = waitResult.totalFrames;

        const save = saveState(wasmboy, wasmboyMemory);
        shelljs.mkdir('-p', 'saves');
        fs.writeFileSync(saveFile, JSON.stringify(save));

        console.log(`Encoding...`);
        await encodeFrames(framesDir, 60 / recordInterval);

        const end = new Date();
        console.log(`${(end.getTime() - start.getTime()) / 1000}s`)

        console.log(`Sending...`);

        const message = await channel.send({
            files: [{
                attachment: path.resolve(path.join('output', 'outputfile.gif')),
            }],
            components: buttons(false),
        });


        console.log(`Waiting...`);
        let multiplier = 1;
        while (true) {
            const interaction = await new Promise<Interaction<CacheType>>((res, rej) => {
                client.once('interactionCreate', res);
            });


            if (interaction.isButton()) {
                if (isNumeric(interaction.customId)) {
                    // nothing
                } else {
                    await message.edit({ components: buttons(true, interaction.customId) });
                }

                await interaction.update({});

                if (isNumeric(interaction.customId)) {
                    multiplier = parseInt(interaction.customId);
                } else {
                    playerInputs = range(0, multiplier).map(() => parseInput(interaction.customId));
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

const buttons = (disabled: boolean = false, highlight?: string) => {
    const a = new ButtonBuilder()
        .setCustomId('a')
        .setEmoji('🇦')
        .setDisabled(disabled)
        .setStyle(highlight == 'a' ? ButtonStyle.Success : ButtonStyle.Secondary);

    const b = new ButtonBuilder()
        .setCustomId('b')
        .setEmoji('🇧')
        .setDisabled(disabled)
        .setStyle(highlight == 'b' ? ButtonStyle.Success : ButtonStyle.Secondary);

    const up = new ButtonBuilder()
        .setCustomId('up')
        .setEmoji('⬆️')
        .setDisabled(disabled)
        .setStyle(highlight == 'up' ? ButtonStyle.Success : ButtonStyle.Secondary);

    const down = new ButtonBuilder()
        .setCustomId('down')
        .setEmoji('⬇️')
        .setDisabled(disabled)
        .setStyle(highlight == 'down' ? ButtonStyle.Success : ButtonStyle.Secondary);

    const left = new ButtonBuilder()
        .setCustomId('left')
        .setEmoji('⬅️')
        .setDisabled(disabled)
        .setStyle(highlight == 'left' ? ButtonStyle.Success : ButtonStyle.Secondary);

    const right = new ButtonBuilder()
        .setCustomId('Right')
        .setEmoji('➡️')
        .setDisabled(disabled)
        .setStyle(highlight == 'right' ? ButtonStyle.Success : ButtonStyle.Secondary);

    const select = new ButtonBuilder()
        .setCustomId('select')
        .setEmoji('⏺️')
        .setDisabled(disabled)
        .setStyle(highlight == 'select' ? ButtonStyle.Success : ButtonStyle.Secondary);

    const start = new ButtonBuilder()
        .setCustomId('start')
        .setEmoji('▶️')
        .setDisabled(disabled)
        .setStyle(highlight == 'start' ? ButtonStyle.Success : ButtonStyle.Secondary);

    const multiply = new ButtonBuilder()
        .setCustomId('5')
        .setEmoji('5️⃣')
        .setDisabled(disabled)
        .setStyle(highlight == '5' ? ButtonStyle.Success : ButtonStyle.Secondary);

    return [
        new ActionRowBuilder()
            .addComponents(
                a, b
            ),
        new ActionRowBuilder()
            .addComponents(
                up, down, left, right
            ),
        new ActionRowBuilder()
            .addComponents(
                select, start, multiply
            )
    ] as any[];
}

main().catch(err => {
    console.error(err);
    process.exit(-1);
})
