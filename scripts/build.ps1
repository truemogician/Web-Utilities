$location = Get-Location
Set-Location "$PSScriptRoot/../packages"
$packages = Get-ChildItem -Directory -Name
foreach ($package in $packages) {
	Set-Location $package
	& pnpm run build
	Set-Location ..
}
Set-Location $location