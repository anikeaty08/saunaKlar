/** Mail locales. Rumantsch texts are in Rumantsch Grischun. */
export const MAIL_LOCALES = ['en', 'de', 'fr', 'it', 'rm'] as const;
export type MailLocale = (typeof MAIL_LOCALES)[number];

/** Accepts `de`, `de-CH`, `DE_ch`, …; anything unknown falls back to English. */
export function resolveMailLocale(value: string | null | undefined): MailLocale {
  const base = (value ?? '').trim().toLowerCase().split(/[-_]/)[0];
  return (MAIL_LOCALES as readonly string[]).includes(base ?? '') ? (base as MailLocale) : 'en';
}

/** Intl locale for numbers and dates: Swiss conventions throughout. */
export const INTL_LOCALE: Record<MailLocale, string> = {
  en: 'en-CH',
  de: 'de-CH',
  fr: 'fr-CH',
  it: 'it-CH',
  rm: 'rm-CH',
};

export const REQUEST_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'QUOTED', 'ACCEPTED', 'CLOSED', 'REJECTED', 'CANCELLED'] as const;
export type RequestStatusCode = (typeof REQUEST_STATUSES)[number];

export interface MailStrings {
  greeting(firstName?: string | null): string;
  layout: { questionsReplyOrWrite: string; questionsReply: string; questionsWriteTo(email: string): string };
  status: Record<RequestStatusCode, string>;
  labels: { reference: string; sauna: string; configuredPrice: string; quotedPrice: string; validUntil: string; email: string };
  signupCode: { subject(brand: string): string; preheader(code: string): string; heading: string; body(brand: string): string; note: string };
  resetCode: { subject(brand: string): string; preheader(code: string): string; heading: string; body: string; note: string };
  staffInvite: {
    subject(brand: string): string;
    preheader: string;
    heading(brand: string): string;
    body: string;
    signIn: string;
    mfa: string;
    note: string;
  };
  requestSubmittedCustomer: { subject(ref: string): string; preheader(sauna: string): string; heading: string; body(sauna: string): string; view: string };
  requestSubmittedStaff: {
    subject(ref: string, sauna: string): string;
    preheader(customer: string): string;
    heading: string;
    body(customer: string, sauna: string): string;
    open: string;
  };
  requestStatusChanged: {
    subject(ref: string, status: string): string;
    preheader(status: string): string;
    heading(status: string): string;
    body(ref: string, status: string): string;
    view: string;
  };
  quoteAdded: { subject(ref: string, amount: string): string; preheader(date: string): string; heading: string; body(ref: string): string; cta: string };
  shareLinkCreated: {
    subject(sauna: string): string;
    preheader(date: string): string;
    heading: string;
    body(brand: string, sauna: string): string;
    open: string;
    note(date: string): string;
  };
  accountExists: { subject(brand: string): string; preheader: string; heading: string; body(brand: string): string; signIn: string; forgot: string; reset: string; note: string };
  accountDeleted: { subject(brand: string): string; preheader: string; heading: string; body: string; note: string };
}

const en: MailStrings = {
  greeting: (n) => (n ? `Hello ${n},` : 'Hello,'),
  layout: {
    questionsReplyOrWrite: 'Questions? Reply to this e-mail or write to',
    questionsReply: 'Questions? Reply to this e-mail.',
    questionsWriteTo: (e) => `Questions? Write to ${e}.`,
  },
  status: {
    SUBMITTED: 'Submitted',
    IN_REVIEW: 'In review',
    QUOTED: 'Quoted',
    ACCEPTED: 'Accepted',
    CLOSED: 'Closed',
    REJECTED: 'Declined',
    CANCELLED: 'Cancelled',
  },
  labels: { reference: 'Reference', sauna: 'Sauna', configuredPrice: 'Configured price', quotedPrice: 'Quoted price', validUntil: 'Valid until', email: 'E-mail' },
  signupCode: {
    subject: (b) => `Your ${b} verification code`,
    preheader: (c) => `Your code is ${c}`,
    heading: 'Confirm your e-mail address',
    body: (b) => `Enter this code to finish creating your ${b} account:`,
    note: 'The code is valid for 24 hours. If you did not sign up, you can ignore this e-mail.',
  },
  resetCode: {
    subject: (b) => `Reset your ${b} password`,
    preheader: (c) => `Your reset code is ${c}`,
    heading: 'Reset your password',
    body: 'Enter this code together with your new password:',
    note: 'The code is valid for 1 hour. If you did not ask for a reset, ignore this e-mail; your password stays unchanged.',
  },
  staffInvite: {
    subject: (b) => `You have been invited to ${b}`,
    preheader: 'Your administrator account is ready',
    heading: (b) => `Welcome to ${b}`,
    body: 'An administrator account has been created for you. Sign in with your e-mail address and this temporary password:',
    signIn: 'Sign in',
    mfa: 'At the first sign-in you choose your own password and set up two-factor authentication with an authenticator app (for example 1Password, Google Authenticator or Microsoft Authenticator). Two-factor authentication is mandatory for administrators.',
    note: 'The temporary password expires after 7 days. Never share it; we will never ask you for it.',
  },
  requestSubmittedCustomer: {
    subject: (r) => `We received your request ${r}`,
    preheader: (s) => `${s}: request received`,
    heading: 'Thank you for your request',
    body: (s) => `We have received your request for the configured ${s}. Our team will review it and get back to you.`,
    view: 'View your request',
  },
  requestSubmittedStaff: {
    subject: (r, s) => `New request ${r}: ${s}`,
    preheader: (c) => `From ${c}`,
    heading: 'New configuration request',
    body: (c, s) => `${c} has sent a request for a configured ${s}.`,
    open: 'Open in admin',
  },
  requestStatusChanged: {
    subject: (r, s) => `Request ${r}: ${s}`,
    preheader: (s) => `New status: ${s}`,
    heading: (s) => `Your request is now: ${s}`,
    body: (r, s) => `The status of your request ${r} has changed to “${s}”.`,
    view: 'View your request',
  },
  quoteAdded: {
    subject: (r, a) => `Your quote for ${r}: ${a}`,
    preheader: (d) => `Valid until ${d}`,
    heading: 'Your quote is ready',
    body: (r) => `We have prepared a quote for your request ${r}.`,
    cta: 'Review and accept',
  },
  shareLinkCreated: {
    subject: (s) => `Your ${s} configuration`,
    preheader: (d) => `View it until ${d}`,
    heading: 'A configuration for you',
    body: (b, s) => `${b} has prepared a ${s} configuration for you. You can view it in 3D and in your room, no account needed.`,
    open: 'Open the configuration',
    note: (d) => `The link is valid until ${d}. Anyone with the link can view it, so only forward it to people you trust.`,
  },
  accountExists: {
    subject: (b) => `Your ${b} account`,
    preheader: 'Someone tried to sign up with your e-mail address',
    heading: 'You already have an account',
    body: (b) => `Someone, probably you, tried to create a ${b} account with this e-mail address. You already have one, so no new account was created.`,
    signIn: 'Sign in',
    forgot: 'Forgot your password?',
    reset: 'Reset it here',
    note: 'If this was not you, you can ignore this e-mail. Your account is unchanged.',
  },
  accountDeleted: {
    subject: (b) => `Your ${b} account has been deleted`,
    preheader: 'Your personal data has been removed',
    heading: 'Your account has been deleted',
    body: 'As requested, we have deleted your account and removed your personal data. Records we must keep for legal reasons (such as submitted requests) are no longer linked to you.',
    note: 'If you did not ask for this, contact us right away by replying to this e-mail.',
  },
};

const de: MailStrings = {
  greeting: (n) => (n ? `Guten Tag ${n}` : 'Guten Tag'),
  layout: {
    questionsReplyOrWrite: 'Fragen? Antworten Sie auf diese E-Mail oder schreiben Sie an',
    questionsReply: 'Fragen? Antworten Sie einfach auf diese E-Mail.',
    questionsWriteTo: (e) => `Fragen? Schreiben Sie an ${e}.`,
  },
  status: {
    SUBMITTED: 'Eingereicht',
    IN_REVIEW: 'In Prüfung',
    QUOTED: 'Offeriert',
    ACCEPTED: 'Angenommen',
    CLOSED: 'Abgeschlossen',
    REJECTED: 'Abgelehnt',
    CANCELLED: 'Storniert',
  },
  labels: { reference: 'Referenz', sauna: 'Sauna', configuredPrice: 'Konfigurierter Preis', quotedPrice: 'Offertpreis', validUntil: 'Gültig bis', email: 'E-Mail' },
  signupCode: {
    subject: (b) => `Ihr Bestätigungscode für ${b}`,
    preheader: (c) => `Ihr Code lautet ${c}`,
    heading: 'Bestätigen Sie Ihre E-Mail-Adresse',
    body: (b) => `Geben Sie diesen Code ein, um die Eröffnung Ihres Kontos bei ${b} abzuschliessen:`,
    note: 'Der Code ist 24 Stunden gültig. Falls Sie sich nicht registriert haben, können Sie diese E-Mail ignorieren.',
  },
  resetCode: {
    subject: (b) => `Passwort für ${b} zurücksetzen`,
    preheader: (c) => `Ihr Code zum Zurücksetzen lautet ${c}`,
    heading: 'Passwort zurücksetzen',
    body: 'Geben Sie diesen Code zusammen mit Ihrem neuen Passwort ein:',
    note: 'Der Code ist 1 Stunde gültig. Falls Sie das Zurücksetzen nicht angefordert haben, ignorieren Sie diese E-Mail; Ihr Passwort bleibt unverändert.',
  },
  staffInvite: {
    subject: (b) => `Ihre Einladung zu ${b}`,
    preheader: 'Ihr Administratorkonto ist bereit',
    heading: (b) => `Willkommen bei ${b}`,
    body: 'Für Sie wurde ein Administratorkonto eingerichtet. Melden Sie sich mit Ihrer E-Mail-Adresse und diesem temporären Passwort an:',
    signIn: 'Anmelden',
    mfa: 'Bei der ersten Anmeldung wählen Sie ein eigenes Passwort und richten die Zwei-Faktor-Authentifizierung mit einer Authenticator-App ein (zum Beispiel 1Password, Google Authenticator oder Microsoft Authenticator). Für Administratoren ist die Zwei-Faktor-Authentifizierung obligatorisch.',
    note: 'Das temporäre Passwort läuft nach 7 Tagen ab. Geben Sie es nie weiter; wir werden Sie nie danach fragen.',
  },
  requestSubmittedCustomer: {
    subject: (r) => `Wir haben Ihre Anfrage ${r} erhalten`,
    preheader: (s) => `${s}: Anfrage eingegangen`,
    heading: 'Vielen Dank für Ihre Anfrage',
    body: (s) => `Wir haben Ihre Anfrage für die konfigurierte ${s} erhalten. Unser Team prüft sie und meldet sich bei Ihnen.`,
    view: 'Anfrage ansehen',
  },
  requestSubmittedStaff: {
    subject: (r, s) => `Neue Anfrage ${r}: ${s}`,
    preheader: (c) => `Von ${c}`,
    heading: 'Neue Konfigurationsanfrage',
    body: (c, s) => `${c} hat eine Anfrage für eine konfigurierte ${s} gesendet.`,
    open: 'Im Admin öffnen',
  },
  requestStatusChanged: {
    subject: (r, s) => `Anfrage ${r}: ${s}`,
    preheader: (s) => `Neuer Status: ${s}`,
    heading: (s) => `Ihre Anfrage ist jetzt: ${s}`,
    body: (r, s) => `Der Status Ihrer Anfrage ${r} wurde auf «${s}» geändert.`,
    view: 'Anfrage ansehen',
  },
  quoteAdded: {
    subject: (r, a) => `Ihre Offerte zu ${r}: ${a}`,
    preheader: (d) => `Gültig bis ${d}`,
    heading: 'Ihre Offerte ist bereit',
    body: (r) => `Wir haben für Ihre Anfrage ${r} eine Offerte erstellt.`,
    cta: 'Prüfen und annehmen',
  },
  shareLinkCreated: {
    subject: (s) => `Ihre Konfiguration: ${s}`,
    preheader: (d) => `Ansehen bis ${d}`,
    heading: 'Eine Konfiguration für Sie',
    body: (b, s) => `${b} hat für Sie eine Konfiguration der ${s} vorbereitet. Sie können sie in 3D und in Ihrem Raum ansehen, ganz ohne Konto.`,
    open: 'Konfiguration öffnen',
    note: (d) => `Der Link ist bis ${d} gültig. Alle, die den Link haben, können die Konfiguration ansehen. Leiten Sie ihn deshalb nur an Personen weiter, denen Sie vertrauen.`,
  },
  accountExists: {
    subject: (b) => `Ihr Konto bei ${b}`,
    preheader: 'Jemand wollte sich mit Ihrer E-Mail-Adresse registrieren',
    heading: 'Sie haben bereits ein Konto',
    body: (b) => `Jemand, wahrscheinlich Sie, wollte mit dieser E-Mail-Adresse ein Konto bei ${b} eröffnen. Sie haben bereits eines, deshalb wurde kein neues Konto erstellt.`,
    signIn: 'Anmelden',
    forgot: 'Passwort vergessen?',
    reset: 'Hier zurücksetzen',
    note: 'Falls Sie das nicht waren, können Sie diese E-Mail ignorieren. Ihr Konto bleibt unverändert.',
  },
  accountDeleted: {
    subject: (b) => `Ihr Konto bei ${b} wurde gelöscht`,
    preheader: 'Ihre Personendaten wurden entfernt',
    heading: 'Ihr Konto wurde gelöscht',
    body: 'Wie gewünscht haben wir Ihr Konto gelöscht und Ihre Personendaten entfernt. Unterlagen, die wir aus rechtlichen Gründen aufbewahren müssen (etwa eingereichte Anfragen), sind nicht mehr mit Ihnen verknüpft.',
    note: 'Falls Sie dies nicht veranlasst haben, kontaktieren Sie uns bitte umgehend, indem Sie auf diese E-Mail antworten.',
  },
};

const fr: MailStrings = {
  greeting: (n) => (n ? `Bonjour ${n},` : 'Bonjour,'),
  layout: {
    questionsReplyOrWrite: 'Des questions ? Répondez à cet e-mail ou écrivez à',
    questionsReply: 'Des questions ? Répondez simplement à cet e-mail.',
    questionsWriteTo: (e) => `Des questions ? Écrivez à ${e}.`,
  },
  status: {
    SUBMITTED: 'Envoyée',
    IN_REVIEW: 'En cours d’examen',
    QUOTED: 'Offre envoyée',
    ACCEPTED: 'Acceptée',
    CLOSED: 'Clôturée',
    REJECTED: 'Refusée',
    CANCELLED: 'Annulée',
  },
  labels: { reference: 'Référence', sauna: 'Sauna', configuredPrice: 'Prix configuré', quotedPrice: 'Prix de l’offre', validUntil: 'Valable jusqu’au', email: 'E-mail' },
  signupCode: {
    subject: (b) => `Votre code de vérification ${b}`,
    preheader: (c) => `Votre code est ${c}`,
    heading: 'Confirmez votre adresse e-mail',
    body: (b) => `Saisissez ce code pour terminer la création de votre compte ${b} :`,
    note: 'Le code est valable 24 heures. Si vous ne vous êtes pas inscrit·e, vous pouvez ignorer cet e-mail.',
  },
  resetCode: {
    subject: (b) => `Réinitialisez votre mot de passe ${b}`,
    preheader: (c) => `Votre code de réinitialisation est ${c}`,
    heading: 'Réinitialisez votre mot de passe',
    body: 'Saisissez ce code avec votre nouveau mot de passe :',
    note: 'Le code est valable 1 heure. Si vous n’avez pas demandé de réinitialisation, ignorez cet e-mail ; votre mot de passe reste inchangé.',
  },
  staffInvite: {
    subject: (b) => `Vous êtes invité·e sur ${b}`,
    preheader: 'Votre compte administrateur est prêt',
    heading: (b) => `Bienvenue sur ${b}`,
    body: 'Un compte administrateur a été créé pour vous. Connectez-vous avec votre adresse e-mail et ce mot de passe temporaire :',
    signIn: 'Se connecter',
    mfa: 'Lors de la première connexion, vous choisirez votre propre mot de passe et configurerez l’authentification à deux facteurs avec une application d’authentification (par exemple 1Password, Google Authenticator ou Microsoft Authenticator). L’authentification à deux facteurs est obligatoire pour les administrateurs.',
    note: 'Le mot de passe temporaire expire après 7 jours. Ne le communiquez jamais ; nous ne vous le demanderons jamais.',
  },
  requestSubmittedCustomer: {
    subject: (r) => `Nous avons bien reçu votre demande ${r}`,
    preheader: (s) => `${s} : demande reçue`,
    heading: 'Merci pour votre demande',
    body: (s) => `Nous avons bien reçu votre demande pour le sauna ${s} configuré. Notre équipe va l’examiner et reviendra vers vous.`,
    view: 'Voir votre demande',
  },
  requestSubmittedStaff: {
    subject: (r, s) => `Nouvelle demande ${r} : ${s}`,
    preheader: (c) => `De ${c}`,
    heading: 'Nouvelle demande de configuration',
    body: (c, s) => `${c} a envoyé une demande pour un sauna ${s} configuré.`,
    open: 'Ouvrir dans l’administration',
  },
  requestStatusChanged: {
    subject: (r, s) => `Demande ${r} : ${s}`,
    preheader: (s) => `Nouveau statut : ${s}`,
    heading: (s) => `Votre demande est maintenant : ${s}`,
    body: (r, s) => `Le statut de votre demande ${r} est passé à « ${s} ».`,
    view: 'Voir votre demande',
  },
  quoteAdded: {
    subject: (r, a) => `Votre offre pour ${r} : ${a}`,
    preheader: (d) => `Valable jusqu’au ${d}`,
    heading: 'Votre offre est prête',
    body: (r) => `Nous avons préparé une offre pour votre demande ${r}.`,
    cta: 'Consulter et accepter',
  },
  shareLinkCreated: {
    subject: (s) => `Votre configuration ${s}`,
    preheader: (d) => `À consulter jusqu’au ${d}`,
    heading: 'Une configuration pour vous',
    body: (b, s) => `${b} a préparé pour vous une configuration du sauna ${s}. Vous pouvez la voir en 3D et dans votre pièce, sans créer de compte.`,
    open: 'Ouvrir la configuration',
    note: (d) => `Le lien est valable jusqu’au ${d}. Toute personne disposant du lien peut voir la configuration ; ne le transmettez qu’à des personnes de confiance.`,
  },
  accountExists: {
    subject: (b) => `Votre compte ${b}`,
    preheader: 'Quelqu’un a tenté de s’inscrire avec votre adresse e-mail',
    heading: 'Vous avez déjà un compte',
    body: (b) => `Quelqu’un, probablement vous, a tenté de créer un compte ${b} avec cette adresse e-mail. Vous en avez déjà un ; aucun nouveau compte n’a donc été créé.`,
    signIn: 'Se connecter',
    forgot: 'Mot de passe oublié ?',
    reset: 'Réinitialisez-le ici',
    note: 'Si ce n’était pas vous, vous pouvez ignorer cet e-mail. Votre compte reste inchangé.',
  },
  accountDeleted: {
    subject: (b) => `Votre compte ${b} a été supprimé`,
    preheader: 'Vos données personnelles ont été effacées',
    heading: 'Votre compte a été supprimé',
    body: 'Comme demandé, nous avons supprimé votre compte et effacé vos données personnelles. Les documents que nous devons conserver pour des raisons légales (par exemple les demandes envoyées) ne sont plus liés à vous.',
    note: 'Si vous n’êtes pas à l’origine de cette demande, contactez-nous immédiatement en répondant à cet e-mail.',
  },
};

const it: MailStrings = {
  greeting: (n) => (n ? `Buongiorno ${n},` : 'Buongiorno,'),
  layout: {
    questionsReplyOrWrite: 'Domande? Risponda a questa e-mail o scriva a',
    questionsReply: 'Domande? Risponda semplicemente a questa e-mail.',
    questionsWriteTo: (e) => `Domande? Scriva a ${e}.`,
  },
  status: {
    SUBMITTED: 'Inviata',
    IN_REVIEW: 'In esame',
    QUOTED: 'Offerta inviata',
    ACCEPTED: 'Accettata',
    CLOSED: 'Conclusa',
    REJECTED: 'Respinta',
    CANCELLED: 'Annullata',
  },
  labels: { reference: 'Riferimento', sauna: 'Sauna', configuredPrice: 'Prezzo configurato', quotedPrice: 'Prezzo offerto', validUntil: 'Valida fino al', email: 'E-mail' },
  signupCode: {
    subject: (b) => `Il Suo codice di verifica ${b}`,
    preheader: (c) => `Il Suo codice è ${c}`,
    heading: 'Confermi il Suo indirizzo e-mail',
    body: (b) => `Inserisca questo codice per completare la creazione del Suo account ${b}:`,
    note: 'Il codice è valido 24 ore. Se non si è registrato, può ignorare questa e-mail.',
  },
  resetCode: {
    subject: (b) => `Reimposti la Sua password ${b}`,
    preheader: (c) => `Il Suo codice di reimpostazione è ${c}`,
    heading: 'Reimposti la Sua password',
    body: 'Inserisca questo codice insieme alla nuova password:',
    note: 'Il codice è valido 1 ora. Se non ha richiesto la reimpostazione, ignori questa e-mail: la Sua password resta invariata.',
  },
  staffInvite: {
    subject: (b) => `È stato invitato su ${b}`,
    preheader: 'Il Suo account di amministratore è pronto',
    heading: (b) => `Benvenuto su ${b}`,
    body: 'Abbiamo creato per Lei un account di amministratore. Acceda con il Suo indirizzo e-mail e questa password temporanea:',
    signIn: 'Accedi',
    mfa: 'Al primo accesso sceglierà una password personale e configurerà l’autenticazione a due fattori con un’app di autenticazione (ad esempio 1Password, Google Authenticator o Microsoft Authenticator). Per gli amministratori l’autenticazione a due fattori è obbligatoria.',
    note: 'La password temporanea scade dopo 7 giorni. Non la condivida mai: non gliela chiederemo mai.',
  },
  requestSubmittedCustomer: {
    subject: (r) => `Abbiamo ricevuto la Sua richiesta ${r}`,
    preheader: (s) => `${s}: richiesta ricevuta`,
    heading: 'Grazie per la Sua richiesta',
    body: (s) => `Abbiamo ricevuto la Sua richiesta per la sauna ${s} configurata. Il nostro team la esaminerà e La ricontatterà.`,
    view: 'Visualizza la richiesta',
  },
  requestSubmittedStaff: {
    subject: (r, s) => `Nuova richiesta ${r}: ${s}`,
    preheader: (c) => `Da ${c}`,
    heading: 'Nuova richiesta di configurazione',
    body: (c, s) => `${c} ha inviato una richiesta per una sauna ${s} configurata.`,
    open: 'Apri nell’amministrazione',
  },
  requestStatusChanged: {
    subject: (r, s) => `Richiesta ${r}: ${s}`,
    preheader: (s) => `Nuovo stato: ${s}`,
    heading: (s) => `La Sua richiesta ora è: ${s}`,
    body: (r, s) => `Lo stato della Sua richiesta ${r} è cambiato in «${s}».`,
    view: 'Visualizza la richiesta',
  },
  quoteAdded: {
    subject: (r, a) => `La Sua offerta per ${r}: ${a}`,
    preheader: (d) => `Valida fino al ${d}`,
    heading: 'La Sua offerta è pronta',
    body: (r) => `Abbiamo preparato un’offerta per la Sua richiesta ${r}.`,
    cta: 'Esamina e accetta',
  },
  shareLinkCreated: {
    subject: (s) => `La Sua configurazione ${s}`,
    preheader: (d) => `Consultabile fino al ${d}`,
    heading: 'Una configurazione per Lei',
    body: (b, s) => `${b} ha preparato per Lei una configurazione della sauna ${s}. Può vederla in 3D e nel Suo ambiente, senza bisogno di un account.`,
    open: 'Apri la configurazione',
    note: (d) => `Il link è valido fino al ${d}. Chiunque abbia il link può vedere la configurazione: lo inoltri solo a persone di fiducia.`,
  },
  accountExists: {
    subject: (b) => `Il Suo account ${b}`,
    preheader: 'Qualcuno ha tentato di registrarsi con il Suo indirizzo e-mail',
    heading: 'Ha già un account',
    body: (b) => `Qualcuno, probabilmente Lei, ha tentato di creare un account ${b} con questo indirizzo e-mail. Ne ha già uno, quindi non è stato creato alcun nuovo account.`,
    signIn: 'Accedi',
    forgot: 'Ha dimenticato la password?',
    reset: 'La reimposti qui',
    note: 'Se non è stato Lei, può ignorare questa e-mail. Il Suo account resta invariato.',
  },
  accountDeleted: {
    subject: (b) => `Il Suo account ${b} è stato eliminato`,
    preheader: 'I Suoi dati personali sono stati rimossi',
    heading: 'Il Suo account è stato eliminato',
    body: 'Come richiesto, abbiamo eliminato il Suo account e rimosso i Suoi dati personali. I documenti che dobbiamo conservare per motivi legali (ad esempio le richieste inviate) non sono più collegati a Lei.',
    note: 'Se non ha richiesto Lei l’eliminazione, ci contatti subito rispondendo a questa e-mail.',
  },
};

const rm: MailStrings = {
  greeting: (n) => (n ? `Bun di ${n},` : 'Bun di,'),
  layout: {
    questionsReplyOrWrite: 'Dumondas? Respundai a quest e-mail u scrivai a',
    questionsReply: 'Dumondas? Respundai simplamain a quest e-mail.',
    questionsWriteTo: (e) => `Dumondas? Scrivai a ${e}.`,
  },
  status: {
    SUBMITTED: 'Inoltrada',
    IN_REVIEW: 'En examinaziun',
    QUOTED: 'Offerta tramessa',
    ACCEPTED: 'Acceptada',
    CLOSED: 'Terminada',
    REJECTED: 'Refusada',
    CANCELLED: 'Annullada',
  },
  labels: { reference: 'Referenza', sauna: 'Sauna', configuredPrice: 'Pretsch configurà', quotedPrice: 'Pretsch da l’offerta', validUntil: 'Valaivla fin ils', email: 'E-mail' },
  signupCode: {
    subject: (b) => `Voss code da verificaziun per ${b}`,
    preheader: (c) => `Voss code è ${c}`,
    heading: 'Confermai Vossa adressa dad e-mail',
    body: (b) => `Endatai quest code per terminar l’avertura da Voss conto tar ${b}:`,
    note: 'Il code è valaivel 24 uras. Sche Vus n’avais betg fatg ina registraziun, pudais Vus ignorar quest e-mail.',
  },
  resetCode: {
    subject: (b) => `Redefinir Voss pled-clav per ${b}`,
    preheader: (c) => `Voss code per redefinir è ${c}`,
    heading: 'Redefinir Voss pled-clav',
    body: 'Endatai quest code ensemen cun Voss nov pled-clav:',
    note: 'Il code è valaivel 1 ura. Sche Vus n’avais betg dumandà da redefinir il pled-clav, ignorai quest e-mail; Voss pled-clav resta nunmidà.',
  },
  staffInvite: {
    subject: (b) => `Vus essas envidads tar ${b}`,
    preheader: 'Voss conto d’administratur è pront',
    heading: (b) => `Bainvegni tar ${b}`,
    body: 'Nus avain creà per Vus in conto d’administratur. S’annunziai cun Vossa adressa dad e-mail e cun quest pled-clav temporar:',
    signIn: 'S’annunziar',
    mfa: 'Tar l’emprima annunzia tschernis Vus Voss agen pled-clav ed endrizzais l’autentificaziun da dus facturs cun in’app d’autentificaziun (per exempel 1Password, Google Authenticator u Microsoft Authenticator). Per administraturs è l’autentificaziun da dus facturs obligatorica.',
    note: 'Il pled-clav temporar scada suenter 7 dis. Na dai mai el vinavant; nus na vegnin mai a dumandar Vus per el.',
  },
  requestSubmittedCustomer: {
    subject: (r) => `Nus avain retschavì Vossa dumonda ${r}`,
    preheader: (s) => `${s}: dumonda retschavida`,
    heading: 'Grazia fitg per Vossa dumonda',
    body: (s) => `Nus avain retschavì Vossa dumonda per la sauna ${s} configurada. Noss team la examinescha e sa mettà en contact cun Vus.`,
    view: 'Mussar la dumonda',
  },
  requestSubmittedStaff: {
    subject: (r, s) => `Nova dumonda ${r}: ${s}`,
    preheader: (c) => `Da ${c}`,
    heading: 'Nova dumonda da configuraziun',
    body: (c, s) => `${c} ha tramess ina dumonda per ina sauna ${s} configurada.`,
    open: 'Avrir en l’administraziun',
  },
  requestStatusChanged: {
    subject: (r, s) => `Dumonda ${r}: ${s}`,
    preheader: (s) => `Nov status: ${s}`,
    heading: (s) => `Vossa dumonda è ussa: ${s}`,
    body: (r, s) => `Il status da Vossa dumonda ${r} è vegnì midà en «${s}».`,
    view: 'Mussar la dumonda',
  },
  quoteAdded: {
    subject: (r, a) => `Vossa offerta per ${r}: ${a}`,
    preheader: (d) => `Valaivla fin ils ${d}`,
    heading: 'Vossa offerta è pronta',
    body: (r) => `Nus avain preparà ina offerta per Vossa dumonda ${r}.`,
    cta: 'Examinar ed acceptar',
  },
  shareLinkCreated: {
    subject: (s) => `Vossa configuraziun ${s}`,
    preheader: (d) => `Da vesair fin ils ${d}`,
    heading: 'Ina configuraziun per Vus',
    body: (b, s) => `${b} ha preparà per Vus ina configuraziun da la sauna ${s}. Vus la pudais guardar en 3D ed en Vossa stanza, senza conto.`,
    open: 'Avrir la configuraziun',
    note: (d) => `La colliaziun è valaivla fin ils ${d}. Tgi che ha la colliaziun po guardar la configuraziun; dai ella vinavant mo a persunas da fiducia.`,
  },
  accountExists: {
    subject: (b) => `Voss conto tar ${b}`,
    preheader: 'Insatgi ha empruvà da sa registrar cun Vossa adressa dad e-mail',
    heading: 'Vus avais gia in conto',
    body: (b) => `Insatgi, probablamain Vus, ha empruvà d’avrir in conto tar ${b} cun questa adressa dad e-mail. Vus avais gia in, perquai n’è nagin nov conto vegnì creà.`,
    signIn: 'S’annunziar',
    forgot: 'Emblidà il pled-clav?',
    reset: 'Al redefinir qua',
    note: 'Sche quai n’eras betg Vus, pudais Vus ignorar quest e-mail. Voss conto resta nunmidà.',
  },
  accountDeleted: {
    subject: (b) => `Voss conto tar ${b} è vegnì stizzà`,
    preheader: 'Vossas datas persunalas èn vegnidas allontanadas',
    heading: 'Voss conto è vegnì stizzà',
    body: 'Sco giavischà avain nus stizzà Voss conto ed allontanà Vossas datas persunalas. Documents che nus stuain conservar per motivs giuridics (sco dumondas inoltradas) n’èn betg pli colliads cun Vus.',
    note: 'Sche Vus n’avais betg dumandà quai, contactai nus immediatamain cun respunder a quest e-mail.',
  },
};

export const MAIL_STRINGS: Record<MailLocale, MailStrings> = { en, de, fr, it, rm };
