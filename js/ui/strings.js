// strings.js — de/en text for the multiplayer UI. Pure. The language itself comes from i18n.js
// (window.GG_LANG, shared across all games on github.freaxnx01.ch).

export const STRINGS = {

	en: {
		'mp.button': 'Multiplayer',
		'mp.name': 'Your name',
		'mp.create': 'Create race',
		'mp.join': 'Join race',
		'mp.laps': 'Laps',
		'mp.invite': 'Invite a player',
		'mp.copyLink': 'Copy invite link',
		'mp.copyCode': 'Copy code',
		'mp.copied': 'Copied',
		'mp.expiresIn': 'Expires in {time}',
		'mp.expired': 'Expired — create a new invite',
		'mp.pasteAnswer': 'Paste the answer code',
		'mp.connect': 'Connect',
		'mp.pasteOffer': 'Paste the invite code',
		'mp.createAnswer': 'Create answer',
		'mp.sendAnswer': 'Send this answer code to the host:',
		'mp.waitingHost': 'Waiting for the host to start…',
		'mp.start': 'Start race',
		'mp.needTwo': 'At least two players needed',
		'mp.you': 'you',
		'mp.connected': 'connected',
		'mp.waiting': 'waiting',
		'mp.left': 'left',
		'mp.go': 'GO!',
		'mp.lapOf': 'Lap {lap}/{laps}',
		'mp.finished': 'Finished',
		'mp.results': 'Results',
		'mp.time': 'Time',
		'mp.best': 'Best lap',
		'mp.dnf': 'DNF',
		'mp.rematch': 'Rematch',
		'mp.backToLobby': 'Back to lobby',
		'mp.leave': 'Leave',
		'mp.leaveConfirm': 'Leave the race?',
		'mp.codeInvalid': 'Code invalid or expired — ask for a new one',
		'mp.hostLeft': 'The host left — back to single player',
		'mp.playerLeft': '{name} left',
		'mp.strictNetwork': 'Strict networks (e.g. company Wi-Fi) can block direct connections — try a phone hotspot.',
		'mp.connecting': 'Connecting…',
		'mp.close': 'Close',
		'mp.noFinish': 'This track has no finish line — pick another one to race.',
	},

	de: {
		'mp.button': 'Mehrspieler',
		'mp.name': 'Dein Name',
		'mp.create': 'Rennen erstellen',
		'mp.join': 'Rennen beitreten',
		'mp.laps': 'Runden',
		'mp.invite': 'Spieler einladen',
		'mp.copyLink': 'Einladungslink kopieren',
		'mp.copyCode': 'Code kopieren',
		'mp.copied': 'Kopiert',
		'mp.expiresIn': 'Läuft ab in {time}',
		'mp.expired': 'Abgelaufen — erstelle eine neue Einladung',
		'mp.pasteAnswer': 'Antwortcode einfügen',
		'mp.connect': 'Verbinden',
		'mp.pasteOffer': 'Einladungscode einfügen',
		'mp.createAnswer': 'Antwort erstellen',
		'mp.sendAnswer': 'Schick diesen Antwortcode dem Gastgeber:',
		'mp.waitingHost': 'Warten, bis der Gastgeber startet…',
		'mp.start': 'Rennen starten',
		'mp.needTwo': 'Mindestens zwei Spieler nötig',
		'mp.you': 'Du',
		'mp.connected': 'verbunden',
		'mp.waiting': 'wartet',
		'mp.left': 'weg',
		'mp.go': 'LOS!',
		'mp.lapOf': 'Runde {lap}/{laps}',
		'mp.finished': 'Im Ziel',
		'mp.results': 'Ergebnisse',
		'mp.time': 'Zeit',
		'mp.best': 'Beste Runde',
		'mp.dnf': 'Nicht im Ziel',
		'mp.rematch': 'Revanche',
		'mp.backToLobby': 'Zurück zur Lobby',
		'mp.leave': 'Verlassen',
		'mp.leaveConfirm': 'Rennen verlassen?',
		'mp.codeInvalid': 'Code ungültig oder abgelaufen — bitte um einen neuen',
		'mp.hostLeft': 'Der Gastgeber ist weg — zurück zum Einzelspieler',
		'mp.playerLeft': '{name} ist weg',
		'mp.strictNetwork': 'Strenge Netzwerke (z. B. Firmen-WLAN) können direkte Verbindungen blockieren — versuch es mit einem Handy-Hotspot.',
		'mp.connecting': 'Verbinde…',
		'mp.close': 'Schliessen',
		'mp.noFinish': 'Diese Strecke hat keine Ziellinie — wähl eine andere zum Rennen.',
	},

};

export const FUNNY_NAMES = [ 'Turbo Toast', 'Drift Dachs', 'Kurven Koala', 'Nitro Nudel', 'Speedy Spätzli', 'Bremsklotz Bob', 'Vollgas Vreni', 'Rallye Rösti' ];

// Text for key in lang (falls back to English, then to the key), with {placeholders} filled from vars.
export function t( key, lang, vars = {} ) {

	const text = STRINGS[ lang ]?.[ key ] ?? STRINGS.en[ key ] ?? key;
	return text.replace( /\{(\w+)\}/g, ( m, name ) => ( name in vars ? String( vars[ name ] ) : m ) );

}

export function funnyName( random = Math.random ) {

	return FUNNY_NAMES[ Math.floor( random() * FUNNY_NAMES.length ) ];

}
