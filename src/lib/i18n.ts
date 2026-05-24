import { createContext, useContext } from "react"

export type Locale = "fr" | "en"

type TranslationKeys = {
  // Navigation
  "nav.dashboard": string
  "nav.items": string
  "nav.tickets": string
  "nav.warranties": string
  "nav.merchants": string
  "nav.locations": string
  "nav.cards": string
  "nav.vaults": string
  "nav.settings": string
  "nav.lock": string

  // Common
  "common.add": string
  "common.edit": string
  "common.delete": string
  "common.cancel": string
  "common.save": string
  "common.search": string
  "common.all": string
  "common.active": string
  "common.archived": string
  "common.confirm": string
  "common.export": string
  "common.noResults": string

  // Dashboard
  "dashboard.title": string
  "dashboard.subtitle": string
  "dashboard.totalItems": string
  "dashboard.totalValue": string
  "dashboard.activeWarranties": string
  "dashboard.alerts": string
  "dashboard.recentPurchases": string
  "dashboard.expiringWarranties": string
  "dashboard.daysLeft": string
  "dashboard.urgent": string

  // Items
  "items.title": string
  "items.new": string
  "items.description": string
  "items.purchaseDate": string
  "items.price": string
  "items.merchant": string
  "items.location": string
  "items.card": string
  "items.status": string
  "items.notes": string
  "items.select": string
  "items.none": string
  "items.noItems": string

  // Warranties
  "warranties.title": string
  "warranties.expiring": string
  "warranties.expired": string
  "warranties.daysRemaining": string
  "warranties.months": string

  // Merchants
  "merchants.title": string
  "merchants.new": string
  "merchants.name": string
  "merchants.email": string
  "merchants.phone": string
  "merchants.address": string

  // Locations
  "locations.title": string
  "locations.new": string

  // Cards
  "cards.title": string
  "cards.new": string
  "cards.creditCard": string
  "cards.extWarranty": string
  "cards.extWarrantyDesc": string

  // Vaults
  "vaults.title": string
  "vaults.new": string
  "vaults.switchTo": string
  "vaults.password": string

  // Unlock
  "unlock.title": string
  "unlock.subtitle": string
  "unlock.create": string
  "unlock.unlock": string
  "unlock.masterPassword": string
  "unlock.confirmPassword": string
  "unlock.vaultName": string
  "unlock.minChars": string
  "unlock.mismatch": string
  "unlock.creating": string
  "unlock.unlocking": string
  "unlock.existingVault": string
  "unlock.newVault": string

  // Settings
  "settings.title": string
  "settings.appearance": string
  "settings.light": string
  "settings.dark": string
  "settings.system": string
  "settings.security": string
  "settings.about": string
  "settings.language": string
  "settings.dataLocation": string
  "settings.dataLocationDesc": string
  "settings.activeVault": string
  "settings.vaultFolder": string
  "settings.dbFile": string
  "settings.attachmentsFolder": string
  "settings.dbSize": string
  "settings.openFolder": string
  "settings.copyPath": string
  "settings.copied": string

  // Attachments
  "attachments.title": string
  "attachments.dropOrBrowse": string
  "attachments.maxSize": string
  "attachments.added": string
  "attachments.deleted": string
  "attachments.exported": string
  "attachments.deleteConfirm": string

  // Items extended
  "items.currency": string
  "items.invoiceNumber": string
  "items.productReference": string
  "items.quantity": string
  "items.priceExclTax": string
  "items.taxRate": string
  "items.taxAmount": string
  "items.detailedInfo": string
  "items.warrantyAutoCreated": string

  // Scanner
  "scan.title": string
  "scan.subtitle": string
  "scan.dropOrBrowse": string
  "scan.supportedFormats": string
  "scan.selectImage": string
  "scan.startScan": string
  "scan.scanning": string
  "scan.scanComplete": string
  "scan.scanError": string
  "scan.extractedData": string
  "scan.merchant": string
  "scan.date": string
  "scan.total": string
  "scan.detectedItems": string
  "scan.rawText": string
  "scan.showRaw": string
  "scan.hideRaw": string
  "scan.notDetected": string
  "scan.createPurchase": string
  "scan.instructions": string
  "scan.unsupportedFormat": string
  "scan.pdfError": string
  "scan.attachOriginal": string
  "scan.filterImagesAndPdf": string
  "scan.attachmentAdded": string
  "scan.invoiceNumber": string
  "scan.productReference": string
  "scan.currency": string
  "scan.taxInfo": string
  "scan.priceExclTax": string
  "scan.warranty": string
  "scan.warrantyDetected": string

  // Tickets & codes (digital items)
  "tickets.title": string
  "tickets.subtitle": string
  "tickets.new": string
  "tickets.kind": string
  "tickets.kindTicket": string
  "tickets.kindVoucher": string
  "tickets.kindLicense": string
  "tickets.eventDate": string
  "tickets.eventLocation": string
  "tickets.expirationDate": string
  "tickets.redemptionUrl": string
  "tickets.code": string
  "tickets.codePlaceholder": string
  "tickets.codeStored": string
  "tickets.revealCode": string
  "tickets.hideCode": string
  "tickets.copyCode": string
  "tickets.codeCopied": string
  "tickets.markUsed": string
  "tickets.markNotUsed": string
  "tickets.used": string
  "tickets.notUsed": string
  "tickets.attachFile": string
  "tickets.attachFileHint": string
  "tickets.noItems": string
  "tickets.eventIn": string
  "tickets.expiresIn": string
  "tickets.expired": string
  "tickets.eventPast": string

  // Reminders
  "reminders.title": string
  "reminders.empty": string
  "reminders.event": string
  "reminders.expiration": string
  "reminders.renewal": string

  // Subscriptions
  "nav.subscriptions": string
  "subscriptions.title": string
  "subscriptions.subtitle": string
  "subscriptions.new": string
  "subscriptions.edit": string
  "subscriptions.name": string
  "subscriptions.category": string
  "subscriptions.merchant": string
  "subscriptions.card": string
  "subscriptions.startDate": string
  "subscriptions.nextRenewal": string
  "subscriptions.billingCycle": string
  "subscriptions.cycleInterval": string
  "subscriptions.price": string
  "subscriptions.currency": string
  "subscriptions.autoRenewal": string
  "subscriptions.trialEnd": string
  "subscriptions.cancelBy": string
  "subscriptions.cancellationUrl": string
  "subscriptions.status": string
  "subscriptions.notes": string
  "subscriptions.statusActive": string
  "subscriptions.statusPaused": string
  "subscriptions.statusCancelled": string
  "subscriptions.cycleMonthly": string
  "subscriptions.cycleQuarterly": string
  "subscriptions.cycleYearly": string
  "subscriptions.cycleCustom": string
  "subscriptions.upcomingRenewals": string
  "subscriptions.monthlyCost": string
  "subscriptions.markRenewed": string
  "subscriptions.markedRenewed": string
  "subscriptions.noSubs": string
  "subscriptions.members": string
  "subscriptions.addMember": string
  "subscriptions.memberName": string
  "subscriptions.memberShareAmount": string
  "subscriptions.memberSharePercent": string
  "subscriptions.payments": string
  "subscriptions.logPayment": string
  "subscriptions.paidOn": string
  "subscriptions.amount": string
  "subscriptions.invoices": string
  "subscriptions.deleteConfirm": string
  "subscriptions.created": string
  "subscriptions.updated": string
  "subscriptions.deleted": string
  "subscriptions.inTrial": string
  "subscriptions.renewsIn": string
}

const translations: Record<Locale, TranslationKeys> = {
  fr: {
    "nav.dashboard": "Tableau de bord",
    "nav.items": "Achats",
    "nav.tickets": "Billets & Codes",
    "nav.warranties": "Garanties",
    "nav.merchants": "Marchands",
    "nav.locations": "Lieux",
    "nav.cards": "Cartes",
    "nav.vaults": "Coffres",
    "nav.settings": "Paramètres",
    "nav.lock": "Verrouiller",

    "common.add": "Ajouter",
    "common.edit": "Modifier",
    "common.delete": "Supprimer",
    "common.cancel": "Annuler",
    "common.save": "Enregistrer",
    "common.search": "Rechercher...",
    "common.all": "Tous",
    "common.active": "Actifs",
    "common.archived": "Archivés",
    "common.confirm": "Confirmer",
    "common.export": "Exporter",
    "common.noResults": "Aucun résultat",

    "dashboard.title": "Tableau de bord",
    "dashboard.subtitle": "Vue d'ensemble de vos achats",
    "dashboard.totalItems": "Total articles",
    "dashboard.totalValue": "Valeur totale",
    "dashboard.activeWarranties": "Garanties actives",
    "dashboard.alerts": "Alertes",
    "dashboard.recentPurchases": "Achats récents",
    "dashboard.expiringWarranties": "Garanties bientôt expirées",
    "dashboard.daysLeft": "j restants",
    "dashboard.urgent": "Urgent (7 jours)",

    "items.title": "Achats",
    "items.new": "Nouvel achat",
    "items.description": "Description",
    "items.purchaseDate": "Date d'achat",
    "items.price": "Prix",
    "items.merchant": "Marchand",
    "items.location": "Lieu",
    "items.card": "Carte de paiement",
    "items.status": "Statut",
    "items.notes": "Notes",
    "items.select": "Sélectionner...",
    "items.none": "Aucune",
    "items.noItems": "Aucun achat trouvé",

    "items.currency": "Devise",
    "items.invoiceNumber": "N° de facture",
    "items.productReference": "Réf. produit / SKU",
    "items.quantity": "Quantité",
    "items.priceExclTax": "Prix HT",
    "items.taxRate": "Taux TVA (%)",
    "items.taxAmount": "Montant TVA",
    "items.detailedInfo": "Informations détaillées",
    "items.warrantyAutoCreated": "Garantie créée automatiquement",

    "warranties.title": "Garanties",
    "warranties.expiring": "Bientôt expirées",
    "warranties.expired": "Expirées",
    "warranties.daysRemaining": "j restants",
    "warranties.months": "mois",

    "merchants.title": "Marchands",
    "merchants.new": "Nouveau marchand",
    "merchants.name": "Nom",
    "merchants.email": "Email",
    "merchants.phone": "Téléphone",
    "merchants.address": "Adresse",

    "locations.title": "Lieux",
    "locations.new": "Nouveau lieu",

    "cards.title": "Cartes de paiement",
    "cards.new": "Nouvelle carte",
    "cards.creditCard": "Carte de crédit",
    "cards.extWarranty": "Garantie étendue (mois)",
    "cards.extWarrantyDesc": "Description garantie",

    "vaults.title": "Coffres",
    "vaults.new": "Nouveau coffre",
    "vaults.switchTo": "Basculer vers",
    "vaults.password": "Mot de passe",

    "unlock.title": "TrackBuyV2",
    "unlock.subtitle": "Suivi d'achats chiffré de bout en bout",
    "unlock.create": "Créer un coffre",
    "unlock.unlock": "Déverrouiller",
    "unlock.masterPassword": "Mot de passe maître",
    "unlock.confirmPassword": "Confirmer le mot de passe",
    "unlock.vaultName": "Nom du coffre",
    "unlock.minChars": "Minimum 8 caractères",
    "unlock.mismatch": "Les mots de passe ne correspondent pas",
    "unlock.creating": "Création...",
    "unlock.unlocking": "Déverrouillage...",
    "unlock.existingVault": "Déverrouiller un coffre existant",
    "unlock.newVault": "Créer un nouveau coffre",

    "settings.title": "Paramètres",
    "settings.appearance": "Apparence",
    "settings.light": "Clair",
    "settings.dark": "Sombre",
    "settings.system": "Système",
    "settings.security": "Sécurité",
    "settings.about": "À propos",
    "settings.language": "Langue",
    "settings.dataLocation": "Emplacement des données",
    "settings.dataLocationDesc": "Dossier sur votre disque où la base de données chiffrée et les pièces jointes sont stockées",
    "settings.activeVault": "Coffre actif",
    "settings.vaultFolder": "Dossier du coffre",
    "settings.dbFile": "Fichier de base de données",
    "settings.attachmentsFolder": "Pièces jointes",
    "settings.dbSize": "Taille de la base",
    "settings.openFolder": "Ouvrir le dossier",
    "settings.copyPath": "Copier le chemin",
    "settings.copied": "Chemin copié",

    "attachments.title": "Pièces jointes",
    "attachments.dropOrBrowse": "Glisser des fichiers ici ou parcourir",
    "attachments.maxSize": "Max 100 MB par fichier",
    "attachments.added": "ajouté",
    "attachments.deleted": "Pièce jointe supprimée",
    "attachments.exported": "exporté",
    "attachments.deleteConfirm": "Cette action est irréversible. Le fichier chiffré sera supprimé du disque.",

    "scan.title": "Scanner un reçu",
    "scan.subtitle": "Numérisez un reçu pour extraire automatiquement les informations d'achat",
    "scan.dropOrBrowse": "Glisser une image ici ou cliquer pour parcourir",
    "scan.supportedFormats": "PNG, JPG, WEBP, BMP, TIFF, PDF",
    "scan.selectImage": "Sélectionner un reçu (image ou PDF)",
    "scan.startScan": "Lancer le scan OCR",
    "scan.scanning": "Analyse en cours...",
    "scan.scanComplete": "Scan terminé avec succès",
    "scan.scanError": "Erreur lors du scan",
    "scan.extractedData": "Données extraites",
    "scan.merchant": "Marchand",
    "scan.date": "Date",
    "scan.total": "Total",
    "scan.detectedItems": "Articles détectés",
    "scan.rawText": "Texte brut",
    "scan.showRaw": "Voir le texte",
    "scan.hideRaw": "Masquer",
    "scan.notDetected": "Non détecté",
    "scan.createPurchase": "Créer un achat avec ces données",
    "scan.instructions": "Sélectionnez une image de reçu pour commencer l'analyse OCR",
    "scan.unsupportedFormat": "Format non supporté. Utilisez une image (PNG, JPG, etc.) ou un PDF",
    "scan.pdfError": "Erreur lors de la lecture du PDF",
    "scan.attachOriginal": "Joindre le fichier original à l'article créé",
    "scan.filterImagesAndPdf": "Images et PDF",
    "scan.attachmentAdded": "Pièce jointe ajoutée automatiquement",
    "scan.invoiceNumber": "N° facture",
    "scan.productReference": "Réf. produit",
    "scan.currency": "Devise",
    "scan.taxInfo": "Fiscalité",
    "scan.priceExclTax": "Prix HT",
    "scan.warranty": "Garantie",
    "scan.warrantyDetected": "Garantie détectée",

    "tickets.title": "Billets & Codes",
    "tickets.subtitle": "Billets de concert, bons d'achat et clés de licence",
    "tickets.new": "Nouveau billet ou code",
    "tickets.kind": "Type",
    "tickets.kindTicket": "Billet d'événement",
    "tickets.kindVoucher": "Bon / Voucher",
    "tickets.kindLicense": "Code licence",
    "tickets.eventDate": "Date de l'événement",
    "tickets.eventLocation": "Lieu de l'événement",
    "tickets.expirationDate": "Date d'expiration",
    "tickets.redemptionUrl": "URL d'utilisation",
    "tickets.code": "Code / Clé",
    "tickets.codePlaceholder": "Saisissez le code (sera chiffré sur disque)",
    "tickets.codeStored": "Code stocké et chiffré",
    "tickets.revealCode": "Révéler le code",
    "tickets.hideCode": "Masquer",
    "tickets.copyCode": "Copier",
    "tickets.codeCopied": "Code copié",
    "tickets.markUsed": "Marquer comme utilisé",
    "tickets.markNotUsed": "Marquer comme non utilisé",
    "tickets.used": "Utilisé",
    "tickets.notUsed": "Non utilisé",
    "tickets.attachFile": "Fichier (PDF, QR…)",
    "tickets.attachFileHint": "PDF du billet, capture QR code, etc.",
    "tickets.noItems": "Aucun billet ni code",
    "tickets.eventIn": "Dans {n} jour(s)",
    "tickets.expiresIn": "Expire dans {n} jour(s)",
    "tickets.expired": "Expiré",
    "tickets.eventPast": "Passé",

    "reminders.title": "Rappels à venir",
    "reminders.empty": "Aucun rappel dans les 30 prochains jours",
    "reminders.event": "Événement",
    "reminders.expiration": "Expiration",
    "reminders.renewal": "Renouvellement",

    "nav.subscriptions": "Abonnements",
    "subscriptions.title": "Abonnements",
    "subscriptions.subtitle": "Vos paiements récurrents",
    "subscriptions.new": "Nouvel abonnement",
    "subscriptions.edit": "Modifier l'abonnement",
    "subscriptions.name": "Nom",
    "subscriptions.category": "Catégorie",
    "subscriptions.merchant": "Fournisseur",
    "subscriptions.card": "Carte de paiement",
    "subscriptions.startDate": "Date de début",
    "subscriptions.nextRenewal": "Prochain renouvellement",
    "subscriptions.billingCycle": "Cycle de facturation",
    "subscriptions.cycleInterval": "Intervalle",
    "subscriptions.price": "Prix",
    "subscriptions.currency": "Devise",
    "subscriptions.autoRenewal": "Renouvellement automatique",
    "subscriptions.trialEnd": "Fin de l'essai gratuit",
    "subscriptions.cancelBy": "Annuler avant le",
    "subscriptions.cancellationUrl": "URL d'annulation",
    "subscriptions.status": "Statut",
    "subscriptions.notes": "Notes",
    "subscriptions.statusActive": "Actif",
    "subscriptions.statusPaused": "En pause",
    "subscriptions.statusCancelled": "Annulé",
    "subscriptions.cycleMonthly": "Mensuel",
    "subscriptions.cycleQuarterly": "Trimestriel",
    "subscriptions.cycleYearly": "Annuel",
    "subscriptions.cycleCustom": "Personnalisé (jours)",
    "subscriptions.upcomingRenewals": "Renouvellements à venir",
    "subscriptions.monthlyCost": "Coût mensuel total",
    "subscriptions.markRenewed": "Marquer renouvelé",
    "subscriptions.markedRenewed": "Renouvellement enregistré",
    "subscriptions.noSubs": "Aucun abonnement",
    "subscriptions.members": "Membres",
    "subscriptions.addMember": "Ajouter un membre",
    "subscriptions.memberName": "Nom",
    "subscriptions.memberShareAmount": "Part (montant)",
    "subscriptions.memberSharePercent": "Part (%)",
    "subscriptions.payments": "Historique des paiements",
    "subscriptions.logPayment": "Logger un paiement",
    "subscriptions.paidOn": "Date du paiement",
    "subscriptions.amount": "Montant",
    "subscriptions.invoices": "Factures",
    "subscriptions.deleteConfirm": "Cet abonnement, son historique de paiements, ses membres et ses pièces jointes seront supprimés définitivement.",
    "subscriptions.created": "Abonnement créé",
    "subscriptions.updated": "Abonnement modifié",
    "subscriptions.deleted": "Abonnement supprimé",
    "subscriptions.inTrial": "Période d'essai",
    "subscriptions.renewsIn": "Renouvelle dans",
  },

  en: {
    "nav.dashboard": "Dashboard",
    "nav.items": "Purchases",
    "nav.tickets": "Tickets & Codes",
    "nav.warranties": "Warranties",
    "nav.merchants": "Merchants",
    "nav.locations": "Locations",
    "nav.cards": "Cards",
    "nav.vaults": "Vaults",
    "nav.settings": "Settings",
    "nav.lock": "Lock",

    "common.add": "Add",
    "common.edit": "Edit",
    "common.delete": "Delete",
    "common.cancel": "Cancel",
    "common.save": "Save",
    "common.search": "Search...",
    "common.all": "All",
    "common.active": "Active",
    "common.archived": "Archived",
    "common.confirm": "Confirm",
    "common.export": "Export",
    "common.noResults": "No results",

    "dashboard.title": "Dashboard",
    "dashboard.subtitle": "Overview of your purchases",
    "dashboard.totalItems": "Total items",
    "dashboard.totalValue": "Total value",
    "dashboard.activeWarranties": "Active warranties",
    "dashboard.alerts": "Alerts",
    "dashboard.recentPurchases": "Recent purchases",
    "dashboard.expiringWarranties": "Expiring warranties",
    "dashboard.daysLeft": "d left",
    "dashboard.urgent": "Urgent (7 days)",

    "items.title": "Purchases",
    "items.new": "New purchase",
    "items.description": "Description",
    "items.purchaseDate": "Purchase date",
    "items.price": "Price",
    "items.merchant": "Merchant",
    "items.location": "Location",
    "items.card": "Payment card",
    "items.status": "Status",
    "items.notes": "Notes",
    "items.select": "Select...",
    "items.none": "None",
    "items.noItems": "No purchases found",

    "items.currency": "Currency",
    "items.invoiceNumber": "Invoice number",
    "items.productReference": "Product ref. / SKU",
    "items.quantity": "Quantity",
    "items.priceExclTax": "Price excl. tax",
    "items.taxRate": "Tax rate (%)",
    "items.taxAmount": "Tax amount",
    "items.detailedInfo": "Detailed information",
    "items.warrantyAutoCreated": "Warranty created automatically",

    "warranties.title": "Warranties",
    "warranties.expiring": "Expiring soon",
    "warranties.expired": "Expired",
    "warranties.daysRemaining": "d remaining",
    "warranties.months": "months",

    "merchants.title": "Merchants",
    "merchants.new": "New merchant",
    "merchants.name": "Name",
    "merchants.email": "Email",
    "merchants.phone": "Phone",
    "merchants.address": "Address",

    "locations.title": "Locations",
    "locations.new": "New location",

    "cards.title": "Payment cards",
    "cards.new": "New card",
    "cards.creditCard": "Credit card",
    "cards.extWarranty": "Extended warranty (months)",
    "cards.extWarrantyDesc": "Warranty description",

    "vaults.title": "Vaults",
    "vaults.new": "New vault",
    "vaults.switchTo": "Switch to",
    "vaults.password": "Password",

    "unlock.title": "TrackBuyV2",
    "unlock.subtitle": "End-to-end encrypted purchase tracker",
    "unlock.create": "Create a vault",
    "unlock.unlock": "Unlock",
    "unlock.masterPassword": "Master password",
    "unlock.confirmPassword": "Confirm password",
    "unlock.vaultName": "Vault name",
    "unlock.minChars": "Minimum 8 characters",
    "unlock.mismatch": "Passwords do not match",
    "unlock.creating": "Creating...",
    "unlock.unlocking": "Unlocking...",
    "unlock.existingVault": "Unlock an existing vault",
    "unlock.newVault": "Create a new vault",

    "settings.title": "Settings",
    "settings.appearance": "Appearance",
    "settings.light": "Light",
    "settings.dark": "Dark",
    "settings.system": "System",
    "settings.security": "Security",
    "settings.about": "About",
    "settings.language": "Language",
    "settings.dataLocation": "Data location",
    "settings.dataLocationDesc": "Folder on your disk where the encrypted database and attachments are stored",
    "settings.activeVault": "Active vault",
    "settings.vaultFolder": "Vault folder",
    "settings.dbFile": "Database file",
    "settings.attachmentsFolder": "Attachments",
    "settings.dbSize": "Database size",
    "settings.openFolder": "Open folder",
    "settings.copyPath": "Copy path",
    "settings.copied": "Path copied",

    "attachments.title": "Attachments",
    "attachments.dropOrBrowse": "Drag files here or browse",
    "attachments.maxSize": "Max 100 MB per file",
    "attachments.added": "added",
    "attachments.deleted": "Attachment deleted",
    "attachments.exported": "exported",
    "attachments.deleteConfirm": "This action is irreversible. The encrypted file will be deleted from disk.",

    "scan.title": "Scan a receipt",
    "scan.subtitle": "Scan a receipt to automatically extract purchase information",
    "scan.dropOrBrowse": "Drag an image here or click to browse",
    "scan.supportedFormats": "PNG, JPG, WEBP, BMP, TIFF, PDF",
    "scan.selectImage": "Select a receipt (image or PDF)",
    "scan.startScan": "Start OCR scan",
    "scan.scanning": "Scanning...",
    "scan.scanComplete": "Scan completed successfully",
    "scan.scanError": "Scan error",
    "scan.extractedData": "Extracted data",
    "scan.merchant": "Merchant",
    "scan.date": "Date",
    "scan.total": "Total",
    "scan.detectedItems": "Detected items",
    "scan.rawText": "Raw text",
    "scan.showRaw": "Show text",
    "scan.hideRaw": "Hide",
    "scan.notDetected": "Not detected",
    "scan.createPurchase": "Create a purchase with this data",
    "scan.instructions": "Select a receipt image or PDF to start OCR analysis",
    "scan.unsupportedFormat": "Unsupported format. Use an image (PNG, JPG, etc.) or a PDF",
    "scan.pdfError": "Error reading the PDF file",
    "scan.attachOriginal": "Attach the original file to the created item",
    "scan.filterImagesAndPdf": "Images and PDF",
    "scan.attachmentAdded": "Attachment added automatically",
    "scan.invoiceNumber": "Invoice number",
    "scan.productReference": "Product reference",
    "scan.currency": "Currency",
    "scan.taxInfo": "Tax info",
    "scan.priceExclTax": "Price excl. tax",
    "scan.warranty": "Warranty",
    "scan.warrantyDetected": "Warranty detected",

    "tickets.title": "Tickets & Codes",
    "tickets.subtitle": "Concert tickets, vouchers and license keys",
    "tickets.new": "New ticket or code",
    "tickets.kind": "Type",
    "tickets.kindTicket": "Event ticket",
    "tickets.kindVoucher": "Voucher / Coupon",
    "tickets.kindLicense": "License key",
    "tickets.eventDate": "Event date",
    "tickets.eventLocation": "Event location",
    "tickets.expirationDate": "Expiration date",
    "tickets.redemptionUrl": "Redemption URL",
    "tickets.code": "Code / Key",
    "tickets.codePlaceholder": "Enter the code (will be encrypted on disk)",
    "tickets.codeStored": "Code stored and encrypted",
    "tickets.revealCode": "Reveal code",
    "tickets.hideCode": "Hide",
    "tickets.copyCode": "Copy",
    "tickets.codeCopied": "Code copied",
    "tickets.markUsed": "Mark as used",
    "tickets.markNotUsed": "Mark as unused",
    "tickets.used": "Used",
    "tickets.notUsed": "Unused",
    "tickets.attachFile": "File (PDF, QR…)",
    "tickets.attachFileHint": "Ticket PDF, QR code screenshot, etc.",
    "tickets.noItems": "No tickets or codes",
    "tickets.eventIn": "In {n} day(s)",
    "tickets.expiresIn": "Expires in {n} day(s)",
    "tickets.expired": "Expired",
    "tickets.eventPast": "Past",

    "reminders.title": "Upcoming reminders",
    "reminders.empty": "No reminders in the next 30 days",
    "reminders.event": "Event",
    "reminders.expiration": "Expiration",
    "reminders.renewal": "Renewal",

    "nav.subscriptions": "Subscriptions",
    "subscriptions.title": "Subscriptions",
    "subscriptions.subtitle": "Your recurring payments",
    "subscriptions.new": "New subscription",
    "subscriptions.edit": "Edit subscription",
    "subscriptions.name": "Name",
    "subscriptions.category": "Category",
    "subscriptions.merchant": "Provider",
    "subscriptions.card": "Payment card",
    "subscriptions.startDate": "Start date",
    "subscriptions.nextRenewal": "Next renewal",
    "subscriptions.billingCycle": "Billing cycle",
    "subscriptions.cycleInterval": "Interval",
    "subscriptions.price": "Price",
    "subscriptions.currency": "Currency",
    "subscriptions.autoRenewal": "Auto-renewal",
    "subscriptions.trialEnd": "Free trial ends",
    "subscriptions.cancelBy": "Cancel by",
    "subscriptions.cancellationUrl": "Cancellation URL",
    "subscriptions.status": "Status",
    "subscriptions.notes": "Notes",
    "subscriptions.statusActive": "Active",
    "subscriptions.statusPaused": "Paused",
    "subscriptions.statusCancelled": "Cancelled",
    "subscriptions.cycleMonthly": "Monthly",
    "subscriptions.cycleQuarterly": "Quarterly",
    "subscriptions.cycleYearly": "Yearly",
    "subscriptions.cycleCustom": "Custom (days)",
    "subscriptions.upcomingRenewals": "Upcoming renewals",
    "subscriptions.monthlyCost": "Total monthly cost",
    "subscriptions.markRenewed": "Mark renewed",
    "subscriptions.markedRenewed": "Renewal logged",
    "subscriptions.noSubs": "No subscriptions yet",
    "subscriptions.members": "Members",
    "subscriptions.addMember": "Add member",
    "subscriptions.memberName": "Name",
    "subscriptions.memberShareAmount": "Share (amount)",
    "subscriptions.memberSharePercent": "Share (%)",
    "subscriptions.payments": "Payment history",
    "subscriptions.logPayment": "Log a payment",
    "subscriptions.paidOn": "Paid on",
    "subscriptions.amount": "Amount",
    "subscriptions.invoices": "Invoices",
    "subscriptions.deleteConfirm": "This subscription, its payment history, members and attachments will be permanently deleted.",
    "subscriptions.created": "Subscription created",
    "subscriptions.updated": "Subscription updated",
    "subscriptions.deleted": "Subscription deleted",
    "subscriptions.inTrial": "Trial period",
    "subscriptions.renewsIn": "Renews in",
  },
}

export const I18nContext = createContext<{
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: keyof TranslationKeys) => string
}>({
  locale: "fr",
  setLocale: () => {},
  t: (key) => key,
})

export function useI18n() {
  return useContext(I18nContext)
}

export function getTranslation(locale: Locale) {
  return (key: keyof TranslationKeys): string => {
    return translations[locale][key] || key
  }
}
