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
  pname = "omnixa";
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
  env.OMNIXA_DISABLE_MODELS_FETCH = true;
  env.OMNIXA_VERSION = finalAttrs.version;
  env.OMNIXA_CHANNEL = "prod";
  env.NODE_OPTIONS = "--max-old-space-size=4096";

  buildPhase = ''
    runHook preBuild

    cd ./packages/cli
    bun --bun ./script/build.ts --single --skip-install

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -Dm755 dist/cli-*/bin/omnixa $out/bin/omnixa

    # OpenTUI dlopens Wayland for clipboard images.
    wrapProgram $out/bin/omnixa \
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

    ln -s omnixa $out/bin/omnixa2

    runHook postInstall
  '';

  postInstall = lib.optionalString (stdenvNoCC.buildPlatform.canExecute stdenvNoCC.hostPlatform) ''
    # v2 dropped the `completion` subcommand; --completions is the global flag.
    # --completions also accepts sh, which emits the same script as bash.
    # staged to files, substitute below rejects anything that is not a regular file
    $out/bin/omnixa --completions bash > omnixa.bash
    $out/bin/omnixa --completions zsh > _omnixa
    $out/bin/omnixa --completions fish > omnixa.fish

    installShellCompletion --cmd omnixa \
      --bash omnixa.bash \
      --fish omnixa.fish \
      --zsh _omnixa

    # OMNIXA_CLI_NAME is a build-time define, so the omnixa2 copies are
    # renamed rather than regenerated. --replace-fail is a global literal
    # substitution, so any lowercase omnixa that later appears in a
    # description or help text ships as omnixa2 in the omnixa2 copy.
    substitute omnixa.bash omnixa2.bash --replace-fail omnixa omnixa2
    substitute _omnixa _omnixa2 --replace-fail omnixa omnixa2
    substitute omnixa.fish omnixa2.fish --replace-fail omnixa omnixa2

    installShellCompletion --cmd omnixa2 \
      --bash omnixa2.bash \
      --fish omnixa2.fish \
      --zsh _omnixa2
  '';

  nativeInstallCheckInputs = [
    versionCheckHook
    writableTmpDirAsHomeHook
  ];
  doInstallCheck = true;
  versionCheckKeepEnvironment = [ "HOME" "OMNIXA_DISABLE_MODELS_FETCH" ];
  versionCheckProgramArg = "--version";

  passthru = {
    env = finalAttrs.env;
  };

  meta = {
    description = "The open source coding agent";
    homepage = "https://github.com/keerzzz/Omnixa";
    license = lib.licenses.mit;
    mainProgram = "omnixa";
    inherit (node_modules.meta) platforms;
  };
})
