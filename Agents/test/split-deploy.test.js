import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('deploy/github-deploy.sh').replaceAll('\\', '/');
const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8').replaceAll('\r\n', '\n');
const python = process.platform === 'win32' ? 'python' : 'python3';
const gitPath = process.platform === 'win32' ? spawnSync('where.exe', ['git'], { encoding: 'utf8' }).stdout?.trim().split(/\r?\n/)[0] : null;
const gitBin = gitPath && join(dirname(dirname(gitPath)), 'usr', 'bin');
const candidates = [process.env.BASH_BIN, 'bash', ...(gitBin ? [join(gitBin, 'bash.exe'), join(gitBin, 'sh.exe')] : [])].filter(Boolean);
const shell = candidates.find((candidate) => spawnSync(candidate, ['-c', '[[ -n $BASH_VERSION ]]'], { encoding: 'utf8' }).status === 0);
const shellOptions = { skip: !shell && 'Bash is not installed' };
const workflowCode = workflow.split('        run: |\n')[1].split('\n').map((line) => line.replace(/^          /, '')).join('\n');

function temporary(t) {
  const root = mkdtempSync(join(process.env.PI_SCRATCH_DIR || tmpdir(), 'synconym-deploy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, `${command}: ${result.stderr || result.error}`);
  return result.stdout.trim();
}
function bash(code, { cwd, env, input } = {}) {
  const searchPath = process.platform === 'win32' ? `${dirname(shell)};${process.env.PATH}` : process.env.PATH;
  return spawnSync(shell, ['-c', `set -Eeuo pipefail\nsource "$DEPLOY_SCRIPT"\n${process.platform === 'win32' ? 'python3() { python "$@"; }\n' : ''}${code}`], {
    cwd, input, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PATH: searchPath, DEPLOY_SCRIPT: script, SSH_ORIGINAL_COMMAND: '', ...env },
  });
}
function git(root, ...args) { return run('git', ['-C', root, ...args]); }
function repository(t) {
  const root = temporary(t);
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'deploy-test@example.invalid');
  git(root, 'config', 'user.name', 'Deploy test');
  mkdirSync(join(root, 'public'));
  mkdirSync(join(root, 'deploy'));
  writeFileSync(join(root, 'public/index.html'), '<link href="/styles.css"><link href="/selection.css"><script src="/scrollbars.js"></script><script src="/app.js"></script>');
  for (const file of ['app.js', 'scrollbars.js', 'styles.css', 'selection.css', 'icons.svg', 'github-mark.svg', 'render.js']) writeFileSync(join(root, 'public', file), `// ${file}\n`);
  writeFileSync(join(root, 'server.js'), 'v1');
  writeFileSync(join(root, 'deploy/bt-start.sh'), '# fixture');
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'initial');
  return root;
}
function commit(root, file, content) {
  writeFileSync(join(root, file), content);
  git(root, 'add', '-A'); git(root, 'commit', '-qm', 'change');
  return git(root, 'rev-parse', 'HEAD');
}
function classify(root, front, back, target) {
  const result = bash('classify_deployment "$FRONT" "$BACK" "$TARGET"', { cwd: root, env: { FRONT: front, BACK: back, TARGET: target } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('部署入口及工作流具有 Bash 合法语法，source 无副作用', shellOptions, () => {
  assert.equal(spawnSync(shell, ['-n', script]).status, 0);
  const code = workflowCode;
  const syntax = spawnSync(shell, ['-n'], { input: code, encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
  const result = bash('declare -F deploy_main deploy_release classify_deployment >/dev/null');
  assert.equal(result.status, 0, result.stderr);
});

test('基准判断覆盖连续前端、后端滞后、重试、旧任务、未知和分叉历史', shellOptions, (t) => {
  const root = repository(t);
  const a = git(root, 'rev-parse', 'HEAD');
  const b = commit(root, 'public/app.js', '// frontend b');
  const c = commit(root, 'public/render.js', '// frontend c');
  assert.equal(classify(root, a, a, b), 'frontend');
  assert.equal(classify(root, b, a, c), 'frontend');
  assert.equal(classify(root, c, a, c), 'none');
  assert.equal(classify(root, c, a, b), 'stale');
  const d = commit(root, 'server.js', 'v2');
  const e = commit(root, 'public/app.js', '// frontend e');
  assert.equal(classify(root, c, a, e), 'backend');
  assert.equal(classify(root, d, a, e), 'backend');
  assert.equal(classify(root, e, a, e), 'backend', 'same frontend SHA must not hide a stale backend');
  assert.equal(classify(root, d, d, e), 'frontend');
  assert.equal(classify(root, 'f'.repeat(40), a, e), 'backend');
  git(root, 'checkout', '-q', a);
  const branch = commit(root, 'public/app.js', '// divergent');
  assert.equal(classify(root, e, d, branch), 'backend');
  const bad = bash('classify_deployment "$FRONT" "$BACK" invalid', { cwd: root, env: { FRONT: a, BACK: a } });
  assert.equal(bad.status, 2);
});

test('删除和跨目录重命名不能遗漏后端变更，文件名以 NUL 分隔', shellOptions, (t) => {
  const root = repository(t);
  const a = git(root, 'rev-parse', 'HEAD');
  const b = commit(root, 'public/name with space.js', 'x');
  assert.equal(classify(root, a, a, b), 'frontend');
  git(root, 'mv', 'server.js', 'public/server.js');
  git(root, 'commit', '-qm', 'move backend');
  assert.equal(classify(root, b, a, git(root, 'rev-parse', 'HEAD')), 'backend');
});

function deployment(t) {
  const root = repository(t);
  const base = join(root, 'state');
  mkdirSync(base); mkdirSync(join(base, 'frontend')); mkdirSync(join(base, 'releases'));
  mkdirSync(join(base, 'frontend/old')); mkdirSync(join(base, 'releases/old'));
  const old = 'a'.repeat(40), revision = 'b'.repeat(40);
  for (const dir of ['frontend/old', 'releases/old']) writeFileSync(join(base, dir, '.deployed-revision'), old + '\n');
  copyFileSync('deploy/prepare-frontend.py', join(base, 'prepare-frontend.py'));
  copyFileSync('deploy/bt-start.sh', join(base, 'bt-start.sh'));
  const archive = spawnSync('git', ['-C', root, 'archive', '--format=tar.gz', 'HEAD']);
  assert.equal(archive.status, 0);
  writeFileSync(join(base, 'front-state'), `${base.replaceAll('\\', '/')}/frontend/old\n`);
  writeFileSync(join(base, 'back-state'), `${base.replaceAll('\\', '/')}/releases/old\n`);
  const setup = `
base=$TEST_BASE
if command -v cygpath >/dev/null; then base=$(cygpath -u "$base"); fi
assets=$base/frontend
releases=$base/releases
previous_front=$assets/old
previous=$releases/old
echo "$previous_front" > "$base/front-state"
echo "$previous" > "$base/back-state"
revision=${revision}
checksum=$(sha256sum "$TEST_ARCHIVE" | cut -d ' ' -f 1)
mode=$TEST_MODE
record() { echo "$*" >> "$base/events"; }
switch_front() {
  record "front $1"
  if [[ $1 != "$previous_front" && \${FAIL_FRONT_SWITCH:-0} == 1 ]]; then return 1; fi
  echo "$1" > "$base/front-state"
}
switch_backend() {
  record "back $1"
  if [[ $1 != "$previous" && \${FAIL_BACK_SWITCH:-0} == 1 ]]; then return 1; fi
  echo "$1" > "$base/back-state"
}
panel() {
  record "panel $1"
  if [[ $1 == start && $(cat "$base/back-state") != "$previous" && \${FAIL_START:-0} == 1 ]]; then return 1; fi
  if [[ $1 == stop && \${FAIL_STOP:-0} == 1 ]]; then return 1; fi
}
wait_free() { [[ \${FAIL_PORT:-0} != 1 ]]; }
healthy() { [[ $(cat "$base/back-state") == "$previous" || \${FAIL_HEALTH:-0} != 1 ]]; }
verify_front() {
  record "verify $1"
  if [[ $1 != "$previous_front" && \${SEND_TERM:-0} == 1 ]]; then kill -TERM $$; fi
  if [[ $1 != "$previous_front" && \${FAIL_VERIFY:-0} == 1 ]]; then return 1; fi
}
chown() { record chown; }
npm() {
  record "npm $npm_config_registry"
  if [[ \${FAIL_NPM:-0} == 1 ]]; then return 1; fi
  if [[ \${FAIL_MIRROR:-0} == 1 && $npm_config_registry == https://registry.npmmirror.com ]]; then return 1; fi
}
deploy_release
`;
  // Test harness overrides only service operations. Upload, hashing, extraction, snapshot and traps are real.
  const archivePath = join(root, 'upload.tar.gz');
  writeFileSync(archivePath, archive.stdout);
  return {
    root, base, revision, archivePath,
    deploy(mode = 'frontend', faults = {}, input = archive.stdout) {
      return bash(setup, { input, env: { TEST_BASE: base.replaceAll('\\', '/'), TEST_ARCHIVE: archivePath.replaceAll('\\', '/'), TEST_MODE: mode, ...faults } });
    },
    events() { return existsSync(join(base, 'events')) ? readFileSync(join(base, 'events'), 'utf8') : ''; },
    state(kind) { return readFileSync(join(base, `${kind}-state`), 'utf8').trim(); },
  };
}

test('前端部署不重启进程；同版本重试不覆盖不可变快照', shellOptions, (t) => {
  const fixture = deployment(t);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = fixture.deploy();
    assert.equal(result.status, 0, result.stderr);
  }
  assert.equal(basename(fixture.state('front')), fixture.revision);
  assert.equal(basename(fixture.state('back')), 'old');
  assert.doesNotMatch(fixture.events(), /panel|npm/);
  assert.equal(existsSync(join(fixture.base, 'deploy.pending')), false);
  assert.equal(readdirSync(fixture.base).some((name) => /^(upload\.|frontend-build\.)/.test(name)), false);
});

test('前端验证、切换失败和 TERM 均回滚，失败快照可重试', shellOptions, (t) => {
  const fixture = deployment(t);
  for (const faults of [{ FAIL_VERIFY: '1' }, { FAIL_FRONT_SWITCH: '1' }, { SEND_TERM: '1' }]) {
    const result = fixture.deploy('frontend', faults);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Rollback succeeded/);
    assert.equal(basename(fixture.state('front')), 'old');
    assert.doesNotMatch(fixture.events(), /panel/);
  }
  const retry = fixture.deploy();
  assert.equal(retry.status, 0, retry.stderr);
});

for (const fault of ['FAIL_VERIFY', 'FAIL_FRONT_SWITCH', 'FAIL_BACK_SWITCH', 'FAIL_START', 'FAIL_STOP', 'FAIL_HEALTH']) {
  test(`后端故障 ${fault} 同时恢复前后端并允许重试`, shellOptions, (t) => {
    const fixture = deployment(t);
    const result = fixture.deploy('backend', { [fault]: '1' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Rollback succeeded/, result.stderr);
    assert.equal(basename(fixture.state('front')), 'old');
    assert.equal(basename(fixture.state('back')), 'old');
    assert.equal(existsSync(join(fixture.base, 'deploy.pending')), false);
    const retry = fixture.deploy('backend');
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(basename(fixture.state('front')), fixture.revision);
    assert.notEqual(basename(fixture.state('back')), 'old');
  });
}

test('端口未释放时不切换后端，回滚失败保留阻断标记', shellOptions, (t) => {
  const fixture = deployment(t);
  const result = fixture.deploy('backend', { FAIL_PORT: '1' });
  assert.notEqual(result.status, 0);
  assert.equal(basename(fixture.state('back')), 'old');
  assert.doesNotMatch(fixture.events(), /^back /m);
  assert.match(result.stderr, /Rollback failed/);
  assert.equal(existsSync(join(fixture.base, 'deploy.pending')), true);
});

test('依赖镜像失败回退官方源；准备阶段失败不停止旧服务', shellOptions, (t) => {
  const fixture = deployment(t);
  const failure = fixture.deploy('backend', { FAIL_NPM: '1' });
  assert.notEqual(failure.status, 0);
  assert.doesNotMatch(fixture.events(), /panel/);
  assert.equal(existsSync(join(fixture.base, 'deploy.pending')), false);
  const retry = fixture.deploy('backend', { FAIL_MIRROR: '1' });
  assert.equal(retry.status, 0, retry.stderr);
  assert.match(fixture.events(), /npm https:\/\/registry.npmmirror.com\nnpm https:\/\/registry.npmjs.org/);
});

test('损坏校验和在解包和服务切换前拒绝', shellOptions, (t) => {
  const fixture = deployment(t);
  const result = fixture.deploy('backend', {}, Buffer.from('corrupt'));
  assert.notEqual(result.status, 0);
  assert.equal(fixture.events(), '');
  assert.equal(readdirSync(join(fixture.base, 'releases')).length, 1);
});

test('归档路径穿越、符号链接、硬链接和重复路径被拒绝', shellOptions, (t) => {
  const root = temporary(t);
  for (const kind of ['../outside', '/absolute', 'symlink', 'hardlink', 'duplicate']) {
    const archive = join(root, 'unsafe.tar.gz');
    run(python, ['-c', `import io,sys,tarfile
with tarfile.open(sys.argv[1], 'w:gz') as archive:
    name = sys.argv[2]
    item = tarfile.TarInfo(name)
    if name == 'symlink': item.type = tarfile.SYMTYPE; item.linkname = '/tmp/outside'
    if name == 'hardlink': item.type = tarfile.LNKTYPE; item.linkname = '../outside'
    archive.addfile(item, io.BytesIO())
    if name == 'duplicate': archive.addfile(item, io.BytesIO())`, archive, kind]);
    const result = bash('validate_archive "$ARCHIVE"', { env: { ARCHIVE: archive.replaceAll('\\', '/') } });
    assert.notEqual(result.status, 0, kind);
    assert.match(result.stderr, /Unsafe archive member/, kind);
  }
});

test('拒绝旧协议与注入命令；工作流每次重试重新读取双基准', shellOptions, () => {
  for (const command of ['deploy frontend ' + 'a'.repeat(40) + ' ' + 'b'.repeat(64) + ' ' + 'c'.repeat(40), 'status; touch /tmp/injected', 'deploy backend invalid']) {
    const result = bash('deploy_main', { env: { SSH_ORIGINAL_COMMAND: command } });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /Invalid deploy command/);
  }
  assert.match(workflow, /for attempt in 1 2 3; do[\s\S]*current=\$\(ssh[\s\S]*--classify/);
  assert.match(workflow, /\$checksum \$frontend \$backend/);
  assert.match(workflow, /StrictHostKeyChecking=yes/);
});

test('工作流连接失败后重新读取基准；发布成功但 SSH 断开时不重复发布', shellOptions, (t) => {
  const root = repository(t);
  const baseline = git(root, 'rev-parse', 'HEAD');
  const revision = commit(root, 'public/app.js', '// next');
  const setup = `
HOME=$RUNNER_TEMP/home
mkdir -p "$HOME/.ssh"
for file in github-deploy.sh prepare-frontend.py bt-restart.py; do echo "# $file" > "deploy/$file"; done
bash() { command "$TEST_SHELL" "$@"; }
install() { :; }
chmod() { :; }
rm() { :; }
sleep() { :; }
ssh() {
  local command= arg count=0
  for arg in "$@"; do command=$arg; done
  if [[ $command == checksum ]]; then
    ( cd deploy && sha256sum github-deploy.sh prepare-frontend.py bt-restart.py )
    return 0
  fi
  [[ ! -f $RUNNER_TEMP/status-count ]] || count=$(cat "$RUNNER_TEMP/status-count")
  if [[ $command == status ]]; then
    count=$((count + 1))
    echo "$count" > "$RUNNER_TEMP/status-count"
    if (( count == 1 )); then return 255; fi
    if (( count == 2 )); then echo "$BASELINE $BASELINE"; else echo "$GITHUB_SHA $BASELINE"; fi
  else
    echo "$command" >> "$RUNNER_TEMP/deploy-commands"
    cat >/dev/null
    return 255
  fi
}
`;
  // Use the exact workflow script; Bash child is redirected to the repository deployment classifier.
  const code = workflowCode.replace('bash deploy/github-deploy.sh --classify', 'bash "$DEPLOY_SCRIPT" --classify');
  const result = bash(setup + code, { cwd: root, env: {
    TEST_SHELL: shell.replaceAll('\\', '/'), RUNNER_TEMP: root.replaceAll('\\', '/'),
    BASELINE: baseline, GITHUB_SHA: revision, DEPLOY_KEY: 'fixture', DEPLOY_HOST_KEY: 'fixture', DEPLOY_HOST: 'deploy.invalid',
  } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(root, 'status-count'), 'utf8').trim(), '3');
  const commands = readFileSync(join(root, 'deploy-commands'), 'utf8').trim().split('\n');
  assert.equal(commands.length, 1);
  assert.match(commands[0], new RegExp(`^deploy frontend ${revision} [0-9a-f]{64} ${baseline} ${baseline}$`));
  assert.match(result.stdout, /Already deployed/);
});

test('前端验证覆盖 render.js 等传递依赖，内容不符即失败', shellOptions, (t) => {
  const fixture = deployment(t);
  assert.equal(fixture.deploy().status, 0);
  const code = `
base=$TEST_BASE
if command -v cygpath >/dev/null; then base=$(cygpath -u "$base"); fi
target=$base/frontend/$REVISION
curl() {
  local url= output=
  while (( $# )); do
    case "$1" in
      -o) output=$2; shift 2 ;;
      http:*) url=$1; shift ;;
      *) shift ;;
    esac
  done
  echo "$url" >> "$base/urls"
  if [[ $url == http://127.0.0.1:3000/ ]]; then cp "$target/index.html" "$output"
  elif [[ \${CORRUPT_MODULE:-0} == 1 && $url == */render.js ]]; then echo corrupt > "$output"
  else cp "$target/\${url#*/assets/$REVISION/}" "$output"; fi
}
verify_front "$target"
`;
  const env = { TEST_BASE: fixture.base.replaceAll('\\', '/'), REVISION: fixture.revision };
  const success = bash(code, { env });
  assert.equal(success.status, 0, success.stderr);
  assert.match(readFileSync(join(fixture.base, 'urls'), 'utf8'), /render\.js/);
  const failure = bash(code, { env: { ...env, CORRUPT_MODULE: '1' } });
  assert.notEqual(failure.status, 0);
  assert.equal(readdirSync(fixture.base).some((name) => name.startsWith('verify.')), false);
});

test('SSH 入口在锁内读取双版本并进行前后端 CAS，失败或 pending 不进入发布', shellOptions, (t) => {
  const root = temporary(t);
  const a = 'a'.repeat(40), b = 'b'.repeat(40), revision = 'c'.repeat(40);
  mkdirSync(join(root, 'frontend/old'), { recursive: true });
  mkdirSync(join(root, 'releases/old'), { recursive: true });
  writeFileSync(join(root, 'frontend/old/.deployed-revision'), `${a}\n`);
  writeFileSync(join(root, 'releases/old/.deployed-revision'), `${b}\n`);
  const code = `
configure_deployment() {
  base=$TEST_BASE
  assets=$base/frontend
  releases=$base/releases
  front=$base/frontend-current
  live=$base/current
}
flock() { echo locked > "$base/locked"; }
managed_target() { [[ -f $base/locked ]] && echo "$2/old"; }
deploy_release() { echo accepted; }
deploy_main
`;
  const env = { TEST_BASE: root.replaceAll('\\', '/') };
  const status = bash(code, { env: { ...env, SSH_ORIGINAL_COMMAND: 'status' } });
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.stdout.trim(), `${a} ${b}`);
  const command = `deploy frontend ${revision} ${'d'.repeat(64)} ${a} ${b}`;
  const success = bash(code, { env: { ...env, SSH_ORIGINAL_COMMAND: command } });
  assert.equal(success.status, 0, success.stderr);
  assert.equal(success.stdout.trim(), 'accepted');
  for (const stale of [command.replace(`${a} ${b}`, `${revision} ${b}`), command.replace(`${a} ${b}`, `${a} ${revision}`)]) {
    const rejected = bash(code, { env: { ...env, SSH_ORIGINAL_COMMAND: stale } });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /Live revision changed/);
    assert.equal(rejected.stdout, '');
  }
  writeFileSync(join(root, 'deploy.pending'), 'incomplete');
  const pending = bash(code, { env: { ...env, SSH_ORIGINAL_COMMAND: 'status' } });
  assert.notEqual(pending.status, 0);
  assert.match(pending.stderr, /administrator recovery required/);
});

test('同 SHA 的不可变快照内容不一致时拒绝发布，不停止服务', shellOptions, (t) => {
  const fixture = deployment(t);
  assert.equal(fixture.deploy().status, 0);
  writeFileSync(join(fixture.base, 'frontend', fixture.revision, 'render.js'), '// different');
  const result = fixture.deploy('backend');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Existing immutable frontend differs/);
  assert.doesNotMatch(fixture.events(), /panel/);
  assert.equal(basename(fixture.state('back')), 'old');
});

test('前端回滚失败仍尝试后端恢复，返回失败且保留 pending', shellOptions, (t) => {
  const root = temporary(t);
  writeFileSync(join(root, 'deploy.pending'), 'pending');
  const result = bash(`
base=$TEST_BASE
previous_front=old-front
previous=old-back
backend_touched=1
switch_front() { echo front >> "$base/events"; return 1; }
switch_backend() { echo "back $1" >> "$base/events"; }
panel() { echo "panel $1" >> "$base/events"; }
wait_free() { return 0; }
healthy() { return 0; }
verify_front() { return 0; }
rollback_deployment
`, { env: { TEST_BASE: root.replaceAll('\\', '/') } });
  assert.notEqual(result.status, 0);
  assert.match(readFileSync(join(root, 'events'), 'utf8'), /front\npanel stop\nback old-back\npanel start/);
  assert.match(result.stderr, /Rollback failed/);
  assert.equal(existsSync(join(root, 'deploy.pending')), true);
});

test('基础设施校验和只读返回仓库文件指纹，缺少文件即失败', shellOptions, (t) => {
  const root = temporary(t);
  const infra = join(root, 'infra');
  mkdirSync(infra);
  const files = ['github-deploy.sh', 'prepare-frontend.py', 'bt-restart.py'];
  const expected = files.map((file) => {
    const content = `# ${file}\n`;
    writeFileSync(join(infra, file), content);
    return `${createHash('sha256').update(content).digest('hex')}  ${file}`;
  }).join('\n');
  const code = `base=$TEST_INFRA
if command -v cygpath >/dev/null; then base=$(cygpath -u "$base"); fi
infrastructure_checksums`;
  const result = bash(code, { env: { TEST_INFRA: infra.replaceAll('\\', '/') } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), expected);
  assert.equal(existsSync(join(infra, 'releases')), false, '读取指纹不创建部署目录');
  rmSync(join(infra, 'bt-restart.py'));
  const missing = bash(code, { env: { TEST_INFRA: infra.replaceAll('\\', '/') } });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Missing infrastructure file/);
});

test('部署入口只接受 checksum 命令，工作流在打包前比对服务器基础设施', shellOptions, () => {
  for (const command of ['checksum; touch /tmp/injected', 'checksum extra']) {
    const result = bash('deploy_main', { env: { SSH_ORIGINAL_COMMAND: command } });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /Invalid deploy command/);
  }
  assert.match(workflow, /"root@\$DEPLOY_HOST" checksum/);
  assert.match(workflow, /printf '%s\\n' "\$infra" \| sha256sum -c --strict --quiet/);
  assert.ok(workflow.indexOf('"root@$DEPLOY_HOST" checksum') < workflow.indexOf('git archive --format=tar.gz'), '校验必须发生在打包上传之前');
});
