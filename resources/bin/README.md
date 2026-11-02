# Optional native binaries

The default distribution contains no FFmpeg binaries and uses the user's system
FFmpeg installation (`brew install ffmpeg`). `avconvert` always comes from macOS.

Reserved priority locations during development:

- `resources/bin/<arch>/ffmpeg` and `ffprobe` (`arch` is `arm64` or `x64`)
- `resources/bin/ffmpeg` and `ffprobe` (must support the intended target architecture)

`extraResources` copies only these executables into
`MacChromaKey.app/Contents/Resources/bin/`, outside app.asar. A two-architecture
build includes only its matching architecture subdirectory plus optional common
binaries. No files are downloaded here automatically. Executables must have their
execute permission set and work without dependencies on the build machine.

When adding binaries later, place the matching pair together, test both DMGs on
native hardware, and update the distribution/license documentation accordingly.
