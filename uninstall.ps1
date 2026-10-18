<#
    dsh-prompt-inject 卸载脚本（Windows 包装器）
    等价于：node install.mjs uninstall
#>
[CmdletBinding()]
param(
    [string]$Profile = '',
    [string]$Home = '',
    [switch]$Purge
)

$ErrorActionPreference = 'Stop'

function Find-Node {
    if ($env:DSH_NODE_EXE -and (Test-Path -LiteralPath $env:DSH_NODE_EXE)) { return $env:DSH_NODE_EXE }
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe'),
        (Join-Path $env:ProgramFiles 'DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe')
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }
    return $null
}

$node = Find-Node
if (-not $node) {
    throw '找不到 node。请装 Node 20+，或设置环境变量 DSH_NODE_EXE 指向 DeepSeek Harness 自带的 node.exe。'
}

$script = Join-Path $PSScriptRoot 'install.mjs'
if (-not (Test-Path -LiteralPath $script)) { throw "缺 install.mjs：$script" }

$forward = @($script, 'uninstall')
if ($Profile) { $forward += @('--profile', $Profile) }
if ($Home) { $forward += @('--home', $Home) }
if ($Purge) { $forward += '--purge' }

& $node @forward
exit $LASTEXITCODE
