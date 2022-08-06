import * as fs from 'fs';
import * as tmp from 'tmp';
import * as path from 'path';
import * as glob from 'glob';
import { WasmBoy } from 'wasmboy';
import * as shelljs from 'shelljs';
import * as ffmpeg from 'fluent-ffmpeg';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
import { path as ffprobePath } from '@ffprobe-installer/ffprobe';

import { createImageFromFrame, getImageDataFromFrame } from './image';
import { first } from 'lodash';

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

const EXPORT_FPS = 15;

tmp.setGracefulCleanup();

const main = async () => {
    const romFile: string = first(glob.sync('roms/*.gb'));
    if (!romFile) {
        throw new Error('No ROM file');
    }

    const pokemon = new Uint8Array(fs.readFileSync(romFile));

    await WasmBoy.reset({
        headless: true,
        gameboySpeed: 100.0,
        isGbcEnabled: true
    });

    await WasmBoy.loadROM(pokemon);

    const { name: framesDir } = tmp.dirSync();

    console.log(`Emulating...`);
    let i = 0;
    let y = 1;
    const recordInterval = Math.round(60 / EXPORT_FPS);
    for (let second = 0; second < 30; second++) {
        for (let frame = 0; frame < 60; frame++) {
            await WasmBoy._runWasmExport('executeMultipleFrames', [1]);

            if ((i % recordInterval) == 0) {
                const file = path.join(framesDir, `${y++}.png`);
                await createImageFromFrame(await getImageDataFromFrame(), file);
            }

            i++;
        }
    }

    console.log(`Encoding...`);
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

    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(-1);
})
