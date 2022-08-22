import * as sharp from 'sharp';

export interface Recording {
    tmpDir: string
    maxFramerate: number
    executedFrameCount: number
    frames: Frame[]
}

export interface Frame {
    executedFrameCount: number
    frame: any[]
    task: Promise<sharp.OutputInfo>
}

