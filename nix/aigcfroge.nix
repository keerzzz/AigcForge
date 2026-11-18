{
  lib,
  stdenvNoCC,
  callPackage,
  bun,
  nodejs,
  sysctl,
  makeBinaryWrapper,
  models-dev,
  ripgrep,
  wayland,
  installShellFiles,
  versionCheckHook,
  writableTmpDirAsHomeHook,
  node_modules ? callPackage ./node_modules.nix { },
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "aigcfroge";
  inherit (node_modules) version src;
  inherit node_modules;

  nativeBuildInputs = [
    bun
    nodejs # for patchShebangs node_modules
    installShellFiles
    makeBinaryWrapper
    models-dev
    writableTmpDirAsHomeHook
  ];

  postPatch = ''
    # NOTE: Relax Bun version check to be a warning instead of an error
    substituteInPlace packages/script/src/index.ts \
      --replace-fail 'throw new Error(`This script requires bun@''${expectedBunVersionRange}' \
                     'console.warn(`Warning: This script requires bun@''${expectedBunVersionRange}'
  '';

  configurePhase = ''
    runHook preConfigure

    cp -R ${finalAttrs.node_modules}/. .
    patchShebangs node_modules
    patchShebangs packages/*/node_modules

    runHook postConfigure
  '';

  env.MODELS_DEV_API_JSON = "${models-dev}/dist/_api.json";
  env.AIGCFROGE_DISABLE_MODELS_FETCH = true;
  env.AIGCFROGE_VERSION = finalAttrs.version;
  env.AIGCFROGE_CHANNEL = "prod";
  env.NODE_OPTIONS = "--max-old-space-size=4096";

  buildPhase = ''
    runHook preBuild

    cd ./packages/cli
    bun --bun ./script/build.ts --single --skip-install

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -Dm755 dist/cli-*/bin/aigcfroge $out/bin/aigcfroge

    # OpenTUI dlopens Wayland for clipboard images.
    wrapProgram $out/bin/aigcfroge \
      --prefix PATH : ${
        lib.makeBinPath (
          [
            ripgrep
          ]
          # bun runs sysctl to detect if running on rosetta2
          ++ lib.optional stdenvNoCC.hostPlatform.isDarwin sysctl
        )
      } ${lib.optionalString stdenvNoCC.hostPlatform.isLinux ''
        --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath [ wayland ]}
      ''}

    ln -s aigcfroge $out/bin/aigcfroge2

    runHook postInstall
  '';

  postInstall = lib.optionalString (stdenvNoCC.buildPlatform.canExecute stdenvNoCC.hostPlatform) ''
    # v2 dropped the `completion` subcommand; --completions is the global flag.
    # --completions also accepts sh, which emits the same script as bash.
    # staged to files, substitute below rejects anything that is not a regular file
    $out/bin/aigcfroge --completions bash > aigcfroge.bash
    $out/bin/aigcfroge --completions zsh > _aigcfroge
    $out/bin/aigcfroge --completions fish > aigcfroge.fish

    installShellCompletion --cmd aigcfroge \
      --bash aigcfroge.bash \
      --fish aigcfroge.fish \
      --zsh _aigcfroge

    # AIGCFROGE_CLI_NAME is a build-time define, so the aigcfroge2 copies are
    # renamed rather than regenerated. --replace-fail is a global literal
    # substitution, so any lowercase aigcfroge that later appears in a
    # description or help text ships as aigcfroge2 in the aigcfroge2 copy.
    substitute aigcfroge.bash aigcfroge2.bash --replace-fail aigcfroge aigcfroge2
    substitute _aigcfroge _aigcfroge2 --replace-fail aigcfroge aigcfroge2
    substitute aigcfroge.fish aigcfroge2.fish --replace-fail aigcfroge aigcfroge2

    installShellCompletion --cmd aigcfroge2 \
      --bash aigcfroge2.bash \
      --fish aigcfroge2.fish \
      --zsh _aigcfroge2
  '';

  nativeInstallCheckInputs = [
    versionCheckHook
    writableTmpDirAsHomeHook
  ];
  doInstallCheck = true;
  versionCheckKeepEnvironment = [ "HOME" "AIGCFROGE_DISABLE_MODELS_FETCH" ];
  versionCheckProgramArg = "--version";

  passthru = {
    env = finalAttrs.env;
  };

  meta = {
    description = "The open source coding agent";
    homepage = "https://aigcfroge.ai";
    license = lib.licenses.mit;
    mainProgram = "aigcfroge";
    inherit (node_modules.meta) platforms;
  };
})
