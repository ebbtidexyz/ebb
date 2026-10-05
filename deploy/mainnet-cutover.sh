#!/usr/bin/env bash
# Ebb mainnet cutover, run from the repo root on the operator's laptop.
#
#   deploy/mainnet-cutover.sh deploy <TOKEN> [--broadcast]   deploy the vault stack for a launched Pons token
#   deploy/mainnet-cutover.sh api                            switch the VPS API from testnet to mainnet
#   deploy/mainnet-cutover.sh web                            point the website at mainnet (CA, Buy link, vault)
#   deploy/mainnet-cutover.sh status                         on-chain + service checks
#
# Roles come from .secrets/mainnet-roles.env, the deployer/operator/keeper key from .secrets/mainnet-deployer.json.
# Nothing here ever prints a private key.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
HOST=${HOST:-saltbound}
RPC_PUBLIC=https://robinhood-rpc.publicnode.com
RPC_OFFICIAL=https://rpc.mainnet.chain.robinhood.com
FACTORY=0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e
DEP=contracts/deployments/4663.json

set -a; . .secrets/mainnet-roles.env; set +a
key() { python3 -c "import json;d=json.load(open('.secrets/mainnet-deployer.json'))['data'];w=d[0] if isinstance(d,list) else d;print(w['private_key'])"; }
jget() { python3 -c "import json,sys;print(json.load(open('$DEP'))[sys.argv[1]])" "$1"; }

tunnel() {
  pgrep -f "ssh -f -N -D 1080 $HOST" >/dev/null || ssh -f -N -D 1080 "$HOST"
  export ALL_PROXY=socks5h://127.0.0.1:1080
}

case "${1:-}" in
deploy)
  TOKEN="${2:?usage: deploy <TOKEN> [--broadcast]}"
  BROADCAST="${3:-}"
  tunnel
  echo "deployer balance: $(cast balance "$DEPLOYER" --ether --rpc-url "$RPC_PUBLIC") ETH"
  cd contracts
  extra=()
  [ "$BROADCAST" = "--broadcast" ] && extra=(--broadcast --slow)
  PRIVATE_KEY="$(cd .. && key)" TOKEN="$TOKEN" OPERATOR="$OPERATOR" GUARDIAN="$GUARDIAN" TREASURY="$TREASURY" \
    SETTLEMENT="$SETTLEMENT" PAIR="$PAIR" CREATOR_TAX_BPS="$CREATOR_TAX_BPS" \
    forge script script/DeployForToken.s.sol --rpc-url "$RPC_OFFICIAL" ${extra[@]+"${extra[@]}"} 2>&1 | grep -viE "private" | tail -60
  ;;

api)
  [ -f "$DEP" ] || { echo "missing $DEP: run deploy --broadcast first"; exit 1; }
  VAULT=$(jget vault); TOKEN=$(jget token); BLOCK=$(jget deployBlock)
  # chain-derived lines (no secrets) from the deployment file
  ENVLINES=$(cd services/api && npx tsx scripts/mainnet-env-from-deployment.ts "../../$DEP" | grep -E '^[A-Z_]+=.' | grep -vE '^(OPERATOR_PRIVATE_KEY|KEEPER_PRIVATE_KEY|SESSION_SECRET)=')
  PK=$(key)
  SECRET=$(openssl rand -hex 32)
  # keep the OpenRouter key that is already on the server
  ssh "$HOST" "set -e; cd /opt/ebb
    systemctl stop ebb-api
    systemctl disable --now ebb-inflow.timer >/dev/null 2>&1 || true
    [ -f .env.api.testnet ] || cp .env.api .env.api.testnet
    OR=\$(grep '^OPENROUTER_API_KEY=' .env.api.testnet || true)
    umask 077
    {
      echo 'EBB_MODE=chain'; echo 'PORT=8790'; echo 'HOST=127.0.0.1'
      echo 'DB_PATH=./data/ebb-mainnet.sqlite'; echo 'UPSTREAMS_JSON=./upstreams.json'
      echo 'WEB_ORIGIN=https://ebbtide.xyz'; echo 'SIWE_DOMAIN=ebbtide.xyz'
      echo 'CHAIN_ID=4663'; echo 'RPC_URL=$RPC_OFFICIAL'; echo 'PONS_MODE=true'
      cat <<'LINES'
$ENVLINES
LINES
      echo \"SESSION_SECRET=$SECRET\"
      echo \"OPERATOR_PRIVATE_KEY=$PK\"
      echo \"KEEPER_PRIVATE_KEY=$PK\"
      echo \"\$OR\"
    } | awk -F= '!seen[\$1]++' > .env.api.new
    mv .env.api.new .env.api; chown ebb:ebb .env.api
    systemctl start ebb-api; sleep 8; systemctl is-active ebb-api
    journalctl -u ebb-api -n 25 --no-pager | grep -E 'pons|listening|ERROR|ALERT' | cut -c40-220"
  curl -sS https://api.ebbtide.xyz/api/health; echo
  ;;

web)
  [ -f "$DEP" ] || { echo "missing $DEP"; exit 1; }
  VAULT=$(jget vault); TOKEN=$(jget token)
  ssh "$HOST" "set -e; cd /opt/ebb
    [ -f .env.web.testnet ] || cp .env.web .env.web.testnet
    cat > .env.web <<EOF
WEB_PORT=3110
NEXT_PUBLIC_API_URL=https://api.ebbtide.xyz
NEXT_PUBLIC_CHAIN_ID=4663
NEXT_PUBLIC_TOKEN_ADDRESS=$TOKEN
NEXT_PUBLIC_VAULT_ADDRESS=$VAULT
NEXT_PUBLIC_LAUNCH_CA=$TOKEN
NEXT_PUBLIC_BUY_URL=https://www.ponsfamily.com/launchpad/$TOKEN
NEXT_PUBLIC_EXPLORER_URL=https://robin.etherscan.io
EOF
    set -a; . ./.env.web; set +a
    npm run build -w @ebb/web 2>&1 | grep -E 'Compiled|rror' | head -3
    chown -R ebb:ebb /opt/ebb; systemctl restart ebb-web; sleep 5; systemctl is-active ebb-web"
  curl -sS https://ebbtide.xyz/ | grep -oE "$TOKEN|ponsfamily.com/launchpad/$TOKEN" | sort | uniq -c
  ;;

status)
  [ -f "$DEP" ] && { VAULT=$(jget vault); TOKEN=$(jget token);
    echo "vault $VAULT  token $TOKEN";
    echo "creatorFeeRecipient (factory record): $(cast call $FACTORY 'getLaunchedToken(address)' "$TOKEN" --rpc-url "$RPC_PUBLIC" 2>/dev/null | head -c 0)see /api/stats .pons"; }
  echo "deployer balance: $(cast balance "$DEPLOYER" --ether --rpc-url "$RPC_PUBLIC") ETH"
  curl -sS https://api.ebbtide.xyz/api/health; echo
  curl -sS https://api.ebbtide.xyz/api/stats | python3 -c "import json,sys;d=json.load(sys.stdin);print('tide',d['tide']['current'],'pons',d.get('pons'))"
  ;;

*) sed -n 2,9p "$0"; exit 1 ;;
esac
