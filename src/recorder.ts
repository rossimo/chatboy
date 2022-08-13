export interface Recording {
    maxFramerate: number
    executedFrameCount: number
    frames: Frame[]
}

export interface Frame {
    executedFrameCount: number
    frame: any[]
}

