#!/usr/bin/env python3
"""Press a key chord through a temporary kernel-level virtual keyboard (uinput).

Unlike wtype (a Wayland virtual keyboard, which Hyprland doesn't run binds for),
a uinput device looks like real hardware, so compositor keybindings fire. Used by
the end-to-end test to exercise the actual SUPER+SHIFT+Z binding.

    scripts/uinput-keys.py super+shift+z

Needs write access to /dev/uinput (the `input` group). No third-party modules.
"""
import fcntl
import os
import struct
import sys
import time

UI_SET_EVBIT = 0x40045564
UI_SET_KEYBIT = 0x40045565
UI_DEV_CREATE = 0x5501
UI_DEV_DESTROY = 0x5502
EV_SYN, EV_KEY, SYN_REPORT = 0, 1, 0
BUS_USB = 0x03

KEYS = {
    "super": 125, "meta": 125, "shift": 42, "ctrl": 29, "alt": 56,
    "esc": 1, "enter": 28, "tab": 15, "space": 57, "backspace": 14,
    **{c: code for c, code in zip("qwertyuiop", range(16, 26))},
    **{c: code for c, code in zip("asdfghjkl", range(30, 39))},
    **{c: code for c, code in zip("zxcvbnm", range(44, 51))},
}


def emit(fd, etype, code, value):
    now = time.time()
    os.write(fd, struct.pack("llHHi", int(now), int((now % 1) * 1e6), etype, code, value))


def main(chord):
    codes = [KEYS[k] for k in chord.lower().split("+")]
    fd = os.open("/dev/uinput", os.O_WRONLY | os.O_NONBLOCK)
    try:
        fcntl.ioctl(fd, UI_SET_EVBIT, EV_KEY)
        for code in set(KEYS.values()):
            fcntl.ioctl(fd, UI_SET_KEYBIT, code)
        # legacy uinput_user_dev: name[80], input_id, ff_effects_max, abs arrays
        dev = struct.pack("80sHHHHi", b"oma-zotero-test-keyboard", BUS_USB, 0x1234, 0x5678, 1, 0) + b"\0" * (4 * 64 * 4)
        os.write(fd, dev)
        fcntl.ioctl(fd, UI_DEV_CREATE)
        time.sleep(0.8)  # let udev/libinput/Hyprland pick up the new keyboard
        for code in codes:
            emit(fd, EV_KEY, code, 1)
            emit(fd, EV_SYN, SYN_REPORT, 0)
            time.sleep(0.02)
        for code in reversed(codes):
            emit(fd, EV_KEY, code, 0)
            emit(fd, EV_SYN, SYN_REPORT, 0)
            time.sleep(0.02)
        time.sleep(0.2)
    finally:
        try:
            fcntl.ioctl(fd, UI_DEV_DESTROY)
        finally:
            os.close(fd)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: uinput-keys.py super+shift+z")
    main(sys.argv[1])
