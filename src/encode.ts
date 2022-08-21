import * as path from 'path';
import * as tmp from 'tmp';
import * as fs from 'fs';
import * as shelljs from 'shelljs';
import * as sharp from 'sharp';
import * as ffmpeg from 'fluent-ffmpeg';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
import { path as ffprobePath } from '@ffprobe-installer/ffprobe';
import { Recording } from './recorder';

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

export const encodeFrames = async (recording: Recording) => {
    shelljs.mkdir('-p', 'output');

    const { name: tmpDir } = tmp.dirSync();

    const imageTasks = [];
    let framesTxt = '';
    for (let i = 0; i < recording.frames.length; i++) {
        const current = recording.frames[i];
        let file = path.resolve(path.join(tmpDir, `${i + 1}.png`));

        imageTasks.push(await sharp(new Uint8Array(current.frame), {
            raw: {
                width: 160,
                height: 144,
                channels: 4
            }
        }).resize({ width: 320, height: 288, fit: sharp.fit.fill, kernel: sharp.kernel.nearest }).toFile(file));

        framesTxt += `file '${file}'\n`;

        const next = recording.frames[i + 1]
        if (next) {
            framesTxt += `duration ${(next.executedFrameCount - recording.frames[i].executedFrameCount) / 60}\n`;
        }
    }

    await Promise.all(imageTasks);

    framesTxt += `duration 6\nfile '${path.resolve(path.join(tmpDir, `${recording.frames.length}.png`))}'\n`

    fs.writeFileSync('frames.txt', framesTxt);

    await new Promise<void>((res, rej) =>
        ffmpeg()
            .input('frames.txt')
            .addInputOption('-safe', '0')
            .inputFormat('concat')
            .addOption('-filter_complex', `split=2 [a][b]; [a] palettegen=reserve_transparent=off [pal]; [b] fifo [b]; [b] [pal] paletteuse`)
            .output(path.join('output', 'outputfile.gif'))
            .on('error', (err, stdout, stderr) => {
                console.log(stdout)
                console.error(stderr);
                rej(err)
            })
            .on('end', res)
            .run());

    shelljs.rm('-rf', tmpDir);
}