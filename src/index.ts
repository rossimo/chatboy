import * as fs from 'fs';
import * as tmp from 'tmp';
import * as path from 'path';
import * as glob from 'glob';
import { first } from 'lodash';
import * as shelljs from 'shelljs';

import { encodeFrames } from './encode';
import { initWasmBoy, loadRom, loadState, saveSate, setJoypadState } from './wasm';
import { arraysEqual, createImageFromFrame, getImageDataFromFrame } from './image';

const EXPORT_FPS = 15;

tmp.setGracefulCleanup();

const main = async () => {
    const romFile: string = first(glob.sync('roms/*.gb'));
    const saveFile = path.join('saves', path.basename(`${romFile}.sav`));

    if (!romFile) {
        throw new Error('No ROM file');
    }

    const { wasmboy, wasmboyMemory } = await initWasmBoy();

    const rom = new Uint8Array(fs.readFileSync(romFile));
    loadRom(wasmboy, wasmboyMemory, rom);
    wasmboy.config(0, 1, 1, 0, 0, 0, 1, 0, 0, 0);

    if (fs.existsSync(saveFile)) {
        const state = JSON.parse(fs.readFileSync(saveFile).toString());
        loadState(wasmboy, wasmboyMemory, state);
    }

    console.log(`Emulating...`);

    const recordInterval = Math.round(60 / EXPORT_FPS);
    const { name: framesDir } = tmp.dirSync();
    let frames = 0;
    let images = 1;
    let currentFrame = [];
    let previousFrame = [];

    for (let second = 0; second < 30; second++) {
        for (let frame = 0; frame < 60; frame++) {
            wasmboy.executeMultipleFrames(1);
            previousFrame = currentFrame;

            currentFrame = await getImageDataFromFrame(wasmboy, wasmboyMemory);

            /*
            if (!arraysEqual(currentFrame, previousFrame)) {
                console.log(`Frame ${frames} has changed`);
            }
            */

            if ((frames % recordInterval) == 0) {
                const file = path.join(framesDir, `${images++}.png`);
                await createImageFromFrame(currentFrame, file);
            }

            frames++;

            if (frames < 4) {
                setJoypadState(wasmboy, { A: true })
            }
        }
    }

    wasmboy.clearAudioBuffer();

    shelljs.mkdir('-p', 'saves');
    fs.writeFileSync(saveFile, saveSate(wasmboy, wasmboyMemory));

    console.log(`Encoding...`);
    await encodeFrames(framesDir, 60 / recordInterval);
}

main().catch(err => {
    console.error(err);
    process.exit(-1);
})
