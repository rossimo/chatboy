import * as path from 'path';
import * as tmp from 'tmp';
import * as fs from 'fs';
import * as shelljs from 'shelljs';
import * as ffmpeg from 'fluent-ffmpeg';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
import { path as ffprobePath } from '@ffprobe-installer/ffprobe';
import { Recording } from './recorder';
import { createImageFromFrame } from './image';

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

export const encodeFrames = async (recording: Recording) => {
    shelljs.mkdir('-p', 'output');

    const { name: tmpDir } = tmp.dirSync();

    let framesTxt = '';
    for (let i = 0; i < recording.frames.length; i++) {
        const current = recording.frames[i];
        let file = path.resolve(path.join(tmpDir, `${i + 1}.png`));
        await createImageFromFrame(current.frame, file);

        framesTxt += `file '${file}'\n`;

        const next = recording.frames[i + 1]
        if (next) {
            framesTxt += `duration ${(next.executedFrameCount - recording.frames[i].executedFrameCount) / 60}\n`;
        }
    }

    framesTxt += `duration 5\nfile '${path.resolve(path.join(tmpDir, `${recording.frames.length}.png`))}'\n`

    fs.writeFileSync('frames.txt', framesTxt)

    await new Promise<void>((res, rej) =>
        ffmpeg()
            .input('frames.txt')
            .addInputOption('-safe', '0')
            .inputFormat('concat')
            .addOption('-vf', 'palettegen=24', 'palette.png')
            .output(path.join('output', 'outputfile.gif'))
            .on('error', (err, stdout, stderr) => {
                console.log(stdout)
                console.error(stderr);
                rej(err)
            })
            .on('end', res)
            .run());


    await new Promise<void>((res, rej) =>
        ffmpeg()
            .input('frames.txt')
            .addInputOption('-safe', '0')
            .inputFormat('concat')
            .addInput('palette.png')
            .addOption('-filter_complex', `scale=320:-1:flags=neighbor[x];[x][1:v]paletteuse`)
            .output(path.join('output', 'outputfile.gif'))
            .on('error', (err, stdout, stderr) => {
                console.log(stdout)
                console.error(stderr);
                rej(err)
            })
            .on('end', res)
            .run());
}