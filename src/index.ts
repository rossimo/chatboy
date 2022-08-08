import * as fs from 'fs';
import * as tmp from 'tmp';
import * as path from 'path';
import * as glob from 'glob';
import { first } from 'lodash';
import * as shelljs from 'shelljs';
import * as ffmpeg from 'fluent-ffmpeg';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
import { path as ffprobePath } from '@ffprobe-installer/ffprobe';

import { initWasmBoy } from './wasm';
import { arraysEqual, createImageFromFrame, getImageDataFromFrame } from './image';

const EXPORT_FPS = 15;

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

tmp.setGracefulCleanup();

interface ControllerState {
    UP?: boolean
    RIGHT?: boolean
    DOWN?: boolean
    LEFT?: boolean
    A?: boolean
    B?: boolean
    SELECT?: boolean
    START?: boolean
}

const main = async () => {
    const romFile: string = first(glob.sync('roms/*.gb'));
    if (!romFile) {
        throw new Error('No ROM file');
    }

    const saveFile = path.join('saves', path.basename(`${romFile}.sav`));

    const rom = new Uint8Array(fs.readFileSync(romFile));

    const { name: framesDir } = tmp.dirSync();

    const { wasmboy, wasmboyMemory } = await initWasmBoy();

    wasmboyMemory.set(rom, wasmboy.CARTRIDGE_ROM_LOCATION);

    wasmboy.config(
        0, // enableBootRom: i32,
        1, // useGbcWhenAvailable: i32,
        1, // audioBatchProcessing: i32,
        0, // graphicsBatchProcessing: i32,
        0, // timersBatchProcessing: i32,
        0, // graphicsDisableScanlineRendering: i32,
        1, // audioAccumulateSamples: i32,
        0, // tileRendering: i32,
        0, // tileCaching: i32,
        0 // enableAudioDebugging: i32
    );

    if (fs.existsSync(saveFile)) {
        const state = JSON.parse(fs.readFileSync(saveFile).toString());

        wasmboyMemory.set(Uint8Array.from(state.wasmboyMemory.cartridgeRam), wasmboy.CARTRIDGE_RAM_LOCATION);
        wasmboyMemory.set(Uint8Array.from(state.wasmboyMemory.gameBoyMemory), wasmboy.GAMEBOY_INTERNAL_MEMORY_LOCATION);
        wasmboyMemory.set(Uint8Array.from(state.wasmboyMemory.wasmBoyPaletteMemory), wasmboy.GBC_PALETTE_LOCATION);
        wasmboyMemory.set(Uint8Array.from(state.wasmboyMemory.wasmBoyInternalState), wasmboy.WASMBOY_STATE_LOCATION);

        wasmboy.loadState();
    }

    console.log(`Emulating...`);
    let frames = 0;
    let images = 1;

    let controllerState: ControllerState = { A: true };

    const recordInterval = Math.round(60 / EXPORT_FPS);
    let currentFrame = [];
    let previousFrame = [];

    for (let second = 0; second < 30; second++) {
        for (let frame = 0; frame < 60; frame++) {
            wasmboy.executeMultipleFrames(1);
            previousFrame = currentFrame;

            currentFrame = await getImageDataFromFrame(wasmboy, wasmboyMemory);
            if (!arraysEqual(currentFrame, previousFrame)) {
                console.log(`Frame ${frames} has changed`);
            }

            if ((frames % recordInterval) == 0) {
                const file = path.join(framesDir, `${images++}.png`);
                await createImageFromFrame(currentFrame, file);
            }

            frames++;

            if (frames < 4) {
                wasmboy.setJoypadState(
                    controllerState.UP ? 1 : 0,
                    controllerState.RIGHT ? 1 : 0,
                    controllerState.DOWN ? 1 : 0,
                    controllerState.LEFT ? 1 : 0,
                    controllerState.A ? 1 : 0,
                    controllerState.B ? 1 : 0,
                    controllerState.SELECT ? 1 : 0,
                    controllerState.START ? 1 : 0
                )
            }
        }
    }

    wasmboy.clearAudioBuffer();

    if (fs.existsSync(saveFile)) {
        wasmboy.saveState();

        shelljs.mkdir('-p', 'saves');

        fs.writeFileSync(saveFile, JSON.stringify({
            wasmboyMemory: {
                wasmBoyInternalState: Array.from(wasmboyMemory.slice(
                    wasmboy.WASMBOY_STATE_LOCATION,
                    wasmboy.WASMBOY_STATE_LOCATION + wasmboy.WASMBOY_STATE_SIZE
                )),
                wasmBoyPaletteMemory: Array.from(wasmboyMemory.slice(
                    wasmboy.GBC_PALETTE_LOCATION,
                    wasmboy.GBC_PALETTE_LOCATION + wasmboy.GBC_PALETTE_SIZE)),
                gameBoyMemory: Array.from(wasmboyMemory.slice(
                    wasmboy.GAMEBOY_INTERNAL_MEMORY_LOCATION,
                    wasmboy.GAMEBOY_INTERNAL_MEMORY_LOCATION + wasmboy.GAMEBOY_INTERNAL_MEMORY_SIZE
                )),
                cartridgeRam: Array.from(wasmboyMemory.slice(
                    wasmboy.CARTRIDGE_RAM_LOCATION,
                    wasmboy.CARTRIDGE_RAM_LOCATION + wasmboy.CARTRIDGE_RAM_SIZE
                ))
            }
        }));
    }

    console.log(`Encoding...`);
    shelljs.rm('-rf', 'output');
    shelljs.mkdir('-p', 'output');
    await new Promise<void>((res, rej) =>
        ffmpeg()
            .addOption('-framerate', `${60 / recordInterval}`)
            .addOption('-i', path.join(framesDir, `%d.png`))
            .addOption('-vf', `scale=480:-1,format=yuv420p`)
            .addOption('-sws_flags', 'neighbor')
            .output(path.join('output', 'outputfile.mp4'))
            .on('error', rej)
            .on('end', res)
            .run())

    await new Promise<void>((res, rej) =>
        ffmpeg()
            .addInput(path.join('output', `outputfile.mp4`))
            .addOption('-vf', 'palettegen=max_colors=56:reserve_transparent=0')
            .output(path.join('output', 'palette.png'))
            .on('error', rej)
            .on('end', res)
            .run())

    await new Promise<void>((res, rej) =>
        ffmpeg()
            .addInput(path.join('output', `outputfile.mp4`))
            .addInput(path.join('output', `palette.png`))
            .addOption('-filter_complex', `paletteuse`)
            .output(path.join('output', 'outputfile.gif'))
            .on('error', rej)
            .on('end', res)
            .run());
}

main().catch(err => {
    console.error(err);
    process.exit(-1);
})
