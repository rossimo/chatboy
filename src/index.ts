import 'dotenv/config';
import * as fs from 'fs';
import * as tmp from 'tmp';
import * as path from 'path';
import * as glob from 'glob';
import { first, toLower } from 'lodash';
import * as shelljs from 'shelljs';
import { ActionRowBuilder, Attachment, AttachmentBuilder, ButtonBuilder, ButtonStyle, CacheType, Client, EmbedBuilder, GatewayIntentBits, Interaction, TextChannel } from 'discord.js';

import { encodeFrames } from './encode';
import { arraysEqual } from './image';
import { ControllerState, execute, executeAndRecord, initWasmBoy, loadRom, loadState, saveState } from './wasm';

const EXPORT_FPS = 15;
const MAX_EMULATION_SECONDS = 60;
const IDLE_EMULATION_SECONDS = 10;

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
        case 'start':
            return { START: true };
        case 'select':
            return { SELECT: true };
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

    while (true) {
        console.log(`Emulating...`);

        const recordInterval = Math.round(60 / EXPORT_FPS);
        const { name: framesDir } = tmp.dirSync();

        wasmboy.executeMultipleFrames(1);

        let recordedFrames = 1;

        for (const playerInput of playerInputs) {
            const inputResult = await executeAndRecord(wasmboy, wasmboyMemory, playerInput, 4, framesDir, recordInterval, recordedFrames);
            recordedFrames = inputResult.recordedFrames;

            const waitResult = await executeAndRecord(wasmboy, wasmboyMemory, {}, 56, framesDir, recordInterval, recordedFrames);
            recordedFrames = waitResult.recordedFrames;
        }

        playerInputs = [];

        const state = saveState(wasmboy, wasmboyMemory);

        const inputTests: { wasmboy: any, wasmboyMemory: Uint8Array, input: ControllerState }[] = [];
        for (const input of INPUTS) {
            const { wasmboy, wasmboyMemory } = await initWasmBoy();
            inputTests.push({ wasmboy, wasmboyMemory, input })
        }

        inputTests.forEach(test => {
            loadRom(test.wasmboy, test.wasmboyMemory, rom)

            test.wasmboy.config(0, 1, 1, 0, 0, 0, 1, 0, 0, 0);

            loadState(test.wasmboy, test.wasmboyMemory, state);
        });

        /*
        test: for (let i = 0; i < 60 * MAX_EMULATION_SECONDS; i++) {
            const controlResult = await executeAndRecord(wasmboy, wasmboyMemory, {}, 1, framesDir, recordInterval, recordedFrames);
            recordedFrames = controlResult.recordedFrames;

            for (const inputTest of inputTests) {
                const testResult = await execute(inputTest.wasmboy, inputTest.wasmboyMemory, inputTest.input, 1);

                if (!arraysEqual(controlResult.frame, testResult.frame)) {
                    break test;
                }
            }
        }
        */

        const waitResult = await executeAndRecord(wasmboy, wasmboyMemory, {}, 60 * IDLE_EMULATION_SECONDS, framesDir, recordInterval, recordedFrames);
        recordedFrames = waitResult.recordedFrames;

        wasmboy.clearAudioBuffer();

        shelljs.mkdir('-p', 'saves');
        fs.writeFileSync(saveFile, JSON.stringify(saveState(wasmboy, wasmboyMemory)));

        console.log(`Encoding...`);
        await encodeFrames(framesDir, 60 / recordInterval);

        console.log(`Sending...`);


        const buttons = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('a')
                    .setLabel('A')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('b')
                    .setLabel('B')
                    .setStyle(ButtonStyle.Primary)
            )

        const directions = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('up')
                    .setLabel('Up')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('down')
                    .setLabel('Down')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('left')
                    .setLabel('Left')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('Right')
                    .setLabel('Right')
                    .setStyle(ButtonStyle.Primary)
            );

        const menus = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('select')
                    .setLabel('Select')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('start')
                    .setLabel('Start')
                    .setStyle(ButtonStyle.Primary)
            );

        await channel.send({
            files: [{
                attachment: path.resolve(path.join('output', 'outputfile.gif'))
            }],
            components: [buttons as any, directions as any, menus as any]
        });


        console.log(`Waiting...`);
        const interaction = await new Promise<Interaction<CacheType>>((res, rej) => {
            client.once('interactionCreate', res);
        });

        if (interaction.isButton()) {
            playerInputs.push(parseInput(interaction.customId));
            interaction.update({});
        }
    }

    client.destroy();
}

main().catch(err => {
    console.error(err);
    process.exit(-1);
})
