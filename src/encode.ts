import * as path from 'path';
import * as shelljs from 'shelljs';
import * as ffmpeg from 'fluent-ffmpeg';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
import { path as ffprobePath } from '@ffprobe-installer/ffprobe';

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

export const encodeFrames = async (inputDir: string, framerate: number) => {
    shelljs.mkdir('-p', 'output');

    await new Promise<void>((res, rej) =>
        ffmpeg()
            .addOption('-framerate', `${framerate}`)
            .addOption('-i', path.join(inputDir, `%d.png`))
            .addOption('-vf', `scale=320:-1,format=yuv420p`)
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
            .addOption('-filter_complex', `paletteuse`, `-loop`, '-1')
            .output(path.join('output', 'outputfile.gif'))
            .on('error', rej)
            .on('end', res)
            .run());
}