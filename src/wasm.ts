import * as fs from 'fs';
import { last } from 'lodash';
import * as path from 'path';
import { arraysEqual, createImageFromFrame, getImageDataFromFrame } from './image';
import { Recording } from './recorder';

export const initWasmBoy = async () => {
    // Log throttling for our core
    // The same log can't be output more than once every half second
    const logRequest = {};

    const logTimeout = (id, message, timeout) => {
        if (!logRequest[id]) {
            logRequest[id] = true;
            log(id, message);
            setTimeout(() => {
                delete logRequest[id];
            }, timeout);
        }
    };

    const log = (arg0, arg1) => {
        // Grab our arguments, and log as hex
        let logString = '[WasmBoy]';
        if (arg0 !== -9999) logString += ` 0x${arg0.toString(16)} `;
        if (arg1 !== -9999) logString += ` 0x${arg1.toString(16)} `;

        console.log(logString);
    };

    // https://github.com/AssemblyScript/assemblyscript/issues/384
    const wasmImportObject = {
        index: {
            consoleLog: log,
            consoleLogTimeout: logTimeout
        },
        env: {
            abort: () => {
                console.error('AssemblyScript Import Object Aborted!');
            }
        }
    };

    const thing = fs.readFileSync('./core.untouched.wasm');
    const wasmboyCore = await WebAssembly.instantiate(thing, wasmImportObject);
    const wasmboy = wasmboyCore.instance.exports as any;
    const wasmboyMemory = new Uint8Array((wasmboy.memory as any).buffer);

    return {
        wasmboy,
        wasmboyMemory
    }
};

export const loadRom = (wasmboy: any, wasmboyMemory, rom: Uint8Array) => {
    wasmboyMemory.set(rom, wasmboy.CARTRIDGE_ROM_LOCATION);
}

export const loadState = (wasmboy: any, wasmboyMemory, state: any) => {
    wasmboyMemory.set(
        Uint8Array.from(state.wasmboyMemory.cartridgeRam),
        wasmboy.CARTRIDGE_RAM_LOCATION);

    wasmboyMemory.set(
        Uint8Array.from(state.wasmboyMemory.gameBoyMemory),
        wasmboy.GAMEBOY_INTERNAL_MEMORY_LOCATION);

    wasmboyMemory.set(
        Uint8Array.from(state.wasmboyMemory.wasmBoyPaletteMemory),
        wasmboy.GBC_PALETTE_LOCATION);

    wasmboyMemory.set(
        Uint8Array.from(state.wasmboyMemory.wasmBoyInternalState),
        wasmboy.WASMBOY_STATE_LOCATION);

    wasmboy.loadState();
}

export const saveState = (wasmboy: any, wasmboyMemory) => {
    wasmboy.saveState();

    return {
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
    };
}

export interface ControllerState {
    UP?: boolean
    RIGHT?: boolean
    DOWN?: boolean
    LEFT?: boolean
    A?: boolean
    B?: boolean
    SELECT?: boolean
    START?: boolean
}

export const setJoypadState = (wasmboy, controllerState) => {
    wasmboy.setJoypadState(
        controllerState.UP ? 1 : 0,
        controllerState.RIGHT ? 1 : 0,
        controllerState.DOWN ? 1 : 0,
        controllerState.LEFT ? 1 : 0,
        controllerState.A ? 1 : 0,
        controllerState.B ? 1 : 0,
        controllerState.SELECT ? 1 : 0,
        controllerState.START ? 1 : 0);
};

const FRAMES = 4;

export const executeAndRecord = async (wasmboy, wasmboyMemory, input: ControllerState, frameCount: number, recording: Recording) => {
    let elapsedFrameCount = recording.executedFrameCount % (60 / recording.maxFramerate);

    for (let i = 0; i < frameCount; i += FRAMES) {
        setJoypadState(wasmboy, input);

        wasmboy.executeMultipleFrames(FRAMES);

        elapsedFrameCount += FRAMES;

        if (recording.frames.length == 0 || elapsedFrameCount >= (60 / recording.maxFramerate)) {
            const frame = await getImageDataFromFrame(wasmboy, wasmboyMemory);
            const latest = last(recording.frames);

            if (!arraysEqual(latest?.frame, frame)) {
                recording.frames.push({
                    frame,
                    executedFrameCount: recording.executedFrameCount
                });

                elapsedFrameCount = 0;
            }
        }

        recording.executedFrameCount += FRAMES;
    }

    return recording;
}

export const execute = async (wasmboy, wasmboyMemory, input: ControllerState, frameCount: number) => {
    let frame: any[];

    for (let i = 0; i < frameCount; i++) {
        setJoypadState(wasmboy, input);

        wasmboy.executeMultipleFrames(1);
    }

    frame = await getImageDataFromFrame(wasmboy, wasmboyMemory);

    return {
        frame
    }
}