import { createContext, useContext } from "react"

export type Locale = "fr" | "en"

export type TranslationKeys = {
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

  // Engagements (recurring real-world charges)
  "nav.engagements": string
  "nav.creditors": string
  "engagements.title": string
  "engagements.subtitle": string
  "engagements.new": string
  "engagements.edit": string
  "engagements.name": string
  "engagements.type": string
  "engagements.creditor": string
  "engagements.card": string
  "engagements.parent": string
  "engagements.contractRef": string
  "engagements.contractStart": string
  "engagements.contractEnd": string
  "engagements.noticePeriod": string
  "engagements.billingCycle": string
  "engagements.cycleInterval": string
  "engagements.nextDue": string
  "engagements.currentAmount": string
  "engagements.currency": string
  "engagements.paymentMethod": string
  "engagements.autoPay": string
  "engagements.status": string
  "engagements.notes": string
  "engagements.clauses": string
  "engagements.monthlyEquivalent": string
  "engagements.totalMonthlyCost": string
  "engagements.noEngagements": string
  "engagements.deleteConfirm": string
  "engagements.created": string
  "engagements.updated": string
  "engagements.deleted": string
  "engagements.dueIn": string
  "engagements.statusActive": string
  "engagements.statusSuspended": string
  "engagements.statusEnded": string
  "engagements.cycleMonthly": string
  "engagements.cycleQuarterly": string
  "engagements.cycleSemiannual": string
  "engagements.cycleYearly": string
  "engagements.cycleOneShot": string
  "engagements.cycleCustom": string
  "engagements.methodDirectDebit": string
  "engagements.methodQrBill": string
  "engagements.methodBvr": string
  "engagements.methodManualTransfer": string
  "engagements.methodStandingOrder": string
  "engagements.methodCash": string
  "engagements.methodCardAuto": string
  "engagements.methodOther": string
  "engagements.children": string
  "engagements.addChild": string
  "engagements.revisions": string
  "engagements.addRevision": string
  "engagements.charges": string
  "engagements.addCharge": string
  "engagements.markPaid": string
  "engagements.tabOverview": string
  "engagements.tabCharges": string
  "engagements.tabRevisions": string
  "engagements.tabAttachments": string
  "engagements.tabChildren": string
  "engagements.allCategories": string
  "engagements.catInsurance": string
  "engagements.catHousing": string
  "engagements.catVehicle": string
  "engagements.catUtilities": string
  "engagements.catTelecom": string
  "engagements.catTaxes": string
  "engagements.catOther": string

  // Engagement type labels (canonical 27 values)
  "engagements.type.insurance_health": string
  "engagements.type.insurance_household": string
  "engagements.type.insurance_car": string
  "engagements.type.insurance_life": string
  "engagements.type.insurance_legal": string
  "engagements.type.insurance_other": string
  "engagements.type.rent": string
  "engagements.type.parking": string
  "engagements.type.leasing": string
  "engagements.type.mortgage": string
  "engagements.type.electricity": string
  "engagements.type.gas": string
  "engagements.type.water": string
  "engagements.type.fuel": string
  "engagements.type.heating": string
  "engagements.type.phone": string
  "engagements.type.internet": string
  "engagements.type.tv_radio": string
  "engagements.type.tax_federal": string
  "engagements.type.tax_cantonal": string
  "engagements.type.tax_communal": string
  "engagements.type.tax_other": string
  "engagements.type.fine": string
  "engagements.type.fee": string
  "engagements.type.membership": string
  "engagements.type.other": string

  // Charges
  "charges.dueDate": string
  "charges.amount": string
  "charges.periodStart": string
  "charges.periodEnd": string
  "charges.quantity": string
  "charges.unit": string
  "charges.unitPrice": string
  "charges.reference": string
  "charges.invoiceNumber": string
  "charges.paidOn": string
  "charges.statusScheduled": string
  "charges.statusPaid": string
  "charges.statusLate": string
  "charges.statusDisputed": string
  "charges.statusWaived": string
  "charges.noCharges": string

  // Revisions
  "revisions.effectiveDate": string
  "revisions.amount": string
  "revisions.changeReason": string
  "revisions.noRevisions": string

  // Creditors
  "creditors.title": string
  "creditors.subtitle": string
  "creditors.new": string
  "creditors.name": string
  "creditors.type": string
  "creditors.iban": string
  "creditors.referencePrefix": string
  "creditors.contactEmail": string
  "creditors.contactPhone": string
  "creditors.address": string
  "creditors.notes": string
  "creditors.typeInsurer": string
  "creditors.typeLandlord": string
  "creditors.typeUtility": string
  "creditors.typeTelco": string
  "creditors.typeTaxOffice": string
  "creditors.typeLeasingCompany": string
  "creditors.typeEmployer": string
  "creditors.typeBank": string
  "creditors.typeOther": string

  // Incomes
  "nav.incomes": string
  "incomes.title": string
  "incomes.subtitle": string
  "incomes.new": string
  "incomes.edit": string
  "incomes.name": string
  "incomes.type": string
  "incomes.source": string
  "incomes.card": string
  "incomes.cycle": string
  "incomes.cycleInterval": string
  "incomes.nextExpected": string
  "incomes.currentAmount": string
  "incomes.currency": string
  "incomes.status": string
  "incomes.startedOn": string
  "incomes.endedOn": string
  "incomes.notes": string
  "incomes.statusActive": string
  "incomes.statusEnded": string
  "incomes.deleteConfirm": string
  "incomes.created": string
  "incomes.updated": string
  "incomes.deleted": string
  "incomes.noIncomes": string
  "incomes.monthlyTotal": string
  "incomes.showAmounts": string
  "incomes.hideAmounts": string
  "incomes.receipts": string
  "incomes.logReceipt": string
  "incomes.receivedOn": string
  "incomes.amount": string
  "incomes.periodLabel": string
  "incomes.payslipDetail": string
  "incomes.grossAmount": string
  "incomes.socialCharges": string
  "incomes.pension": string
  "incomes.taxAtSource": string
  "incomes.otherDeductions": string
  "incomes.bonus": string
  "incomes.deductionCheck": string
  "incomes.noReceipts": string
  "incomes.totalYTD": string
  "incomes.attachments": string

  // Income type labels
  "incomes.type.salary": string
  "incomes.type.bonus": string
  "incomes.type.thirteenth": string
  "incomes.type.pension": string
  "incomes.type.unemployment": string
  "incomes.type.family_allowance": string
  "incomes.type.dividend": string
  "incomes.type.rental": string
  "incomes.type.gift": string
  "incomes.type.reimbursement": string
  "incomes.type.other": string
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

    "unlock.title": "TrackBuy",
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

    "nav.subscriptions": "Abonnements en ligne",
    "subscriptions.title": "Abonnements en ligne",
    "subscriptions.subtitle": "Streaming, SaaS, cloud, hébergement, gaming",
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

    "nav.engagements": "Engagements",
    "nav.creditors": "Créanciers",
    "engagements.title": "Engagements",
    "engagements.subtitle": "Charges récurrentes : assurances, loyer, fluides, télécom, fiscalité",
    "engagements.new": "Nouvel engagement",
    "engagements.edit": "Modifier l'engagement",
    "engagements.name": "Nom",
    "engagements.type": "Catégorie",
    "engagements.creditor": "Créancier",
    "engagements.card": "Moyen de paiement",
    "engagements.parent": "Engagement parent",
    "engagements.contractRef": "N° de contrat / police",
    "engagements.contractStart": "Début de contrat",
    "engagements.contractEnd": "Fin de contrat",
    "engagements.noticePeriod": "Préavis (jours)",
    "engagements.billingCycle": "Périodicité",
    "engagements.cycleInterval": "Intervalle",
    "engagements.nextDue": "Prochaine échéance",
    "engagements.currentAmount": "Montant courant",
    "engagements.currency": "Devise",
    "engagements.paymentMethod": "Mode de paiement",
    "engagements.autoPay": "Paiement automatique",
    "engagements.status": "Statut",
    "engagements.notes": "Notes",
    "engagements.clauses": "Clauses (JSON libre)",
    "engagements.monthlyEquivalent": "Équivalent mensuel",
    "engagements.totalMonthlyCost": "Coût mensuel total",
    "engagements.noEngagements": "Aucun engagement enregistré.",
    "engagements.deleteConfirm": "Cet engagement, ses échéances, ses révisions et ses pièces jointes seront supprimés définitivement.",
    "engagements.created": "Engagement créé",
    "engagements.updated": "Engagement modifié",
    "engagements.deleted": "Engagement supprimé",
    "engagements.dueIn": "Échéance dans",
    "engagements.statusActive": "Actif",
    "engagements.statusSuspended": "Suspendu",
    "engagements.statusEnded": "Terminé",
    "engagements.cycleMonthly": "Mensuel",
    "engagements.cycleQuarterly": "Trimestriel",
    "engagements.cycleSemiannual": "Semestriel",
    "engagements.cycleYearly": "Annuel",
    "engagements.cycleOneShot": "Ponctuel",
    "engagements.cycleCustom": "Personnalisé (jours)",
    "engagements.methodDirectDebit": "Prélèvement (LSV/SEPA)",
    "engagements.methodQrBill": "QR-facture",
    "engagements.methodBvr": "BVR",
    "engagements.methodManualTransfer": "Virement manuel",
    "engagements.methodStandingOrder": "Ordre permanent",
    "engagements.methodCash": "Espèces",
    "engagements.methodCardAuto": "Carte (auto)",
    "engagements.methodOther": "Autre",
    "engagements.children": "Sous-engagements",
    "engagements.addChild": "Ajouter un sous-engagement",
    "engagements.revisions": "Révisions de contrat",
    "engagements.addRevision": "Ajouter une révision",
    "engagements.charges": "Échéances",
    "engagements.addCharge": "Ajouter une échéance",
    "engagements.markPaid": "Marquer payée",
    "engagements.tabOverview": "Aperçu",
    "engagements.tabCharges": "Échéances",
    "engagements.tabRevisions": "Révisions",
    "engagements.tabAttachments": "Pièces jointes",
    "engagements.tabChildren": "Sous-engagements",
    "engagements.allCategories": "Toutes",
    "engagements.catInsurance": "Assurances",
    "engagements.catHousing": "Logement",
    "engagements.catVehicle": "Véhicule",
    "engagements.catUtilities": "Fluides",
    "engagements.catTelecom": "Télécom",
    "engagements.catTaxes": "Fiscalité",
    "engagements.catOther": "Autres",

    "engagements.type.insurance_health": "Assurance maladie",
    "engagements.type.insurance_household": "Assurance RC ménage",
    "engagements.type.insurance_car": "Assurance auto",
    "engagements.type.insurance_life": "Assurance vie",
    "engagements.type.insurance_legal": "Protection juridique",
    "engagements.type.insurance_other": "Autre assurance",
    "engagements.type.rent": "Loyer",
    "engagements.type.parking": "Place de parc",
    "engagements.type.leasing": "Leasing",
    "engagements.type.mortgage": "Hypothèque",
    "engagements.type.electricity": "Électricité",
    "engagements.type.gas": "Gaz",
    "engagements.type.water": "Eau",
    "engagements.type.fuel": "Carburant / recharge",
    "engagements.type.heating": "Chauffage",
    "engagements.type.phone": "Téléphone",
    "engagements.type.internet": "Internet",
    "engagements.type.tv_radio": "Redevance TV/radio",
    "engagements.type.tax_federal": "Impôt fédéral",
    "engagements.type.tax_cantonal": "Impôt cantonal",
    "engagements.type.tax_communal": "Impôt communal",
    "engagements.type.tax_other": "Autre taxe",
    "engagements.type.fine": "Amende",
    "engagements.type.fee": "Frais administratifs",
    "engagements.type.membership": "Cotisation",
    "engagements.type.other": "Autre",

    "charges.dueDate": "Échéance",
    "charges.amount": "Montant",
    "charges.periodStart": "Début période",
    "charges.periodEnd": "Fin période",
    "charges.quantity": "Quantité",
    "charges.unit": "Unité",
    "charges.unitPrice": "Prix unitaire",
    "charges.reference": "Référence BVR / QR",
    "charges.invoiceNumber": "N° de facture",
    "charges.paidOn": "Payée le",
    "charges.statusScheduled": "Prévue",
    "charges.statusPaid": "Payée",
    "charges.statusLate": "En retard",
    "charges.statusDisputed": "Contestée",
    "charges.statusWaived": "Annulée",
    "charges.noCharges": "Aucune échéance pour le moment.",

    "revisions.effectiveDate": "Date d'effet",
    "revisions.amount": "Nouveau montant",
    "revisions.changeReason": "Motif",
    "revisions.noRevisions": "Aucune révision enregistrée.",

    "creditors.title": "Créanciers",
    "creditors.subtitle": "Assureurs, bailleurs, fournisseurs, administrations",
    "creditors.new": "Nouveau créancier",
    "creditors.name": "Nom",
    "creditors.type": "Type",
    "creditors.iban": "IBAN",
    "creditors.referencePrefix": "Préfixe de référence BVR",
    "creditors.contactEmail": "E-mail",
    "creditors.contactPhone": "Téléphone",
    "creditors.address": "Adresse",
    "creditors.notes": "Notes",
    "creditors.typeInsurer": "Assureur",
    "creditors.typeLandlord": "Bailleur",
    "creditors.typeUtility": "Fournisseur d'énergie",
    "creditors.typeTelco": "Opérateur télécom",
    "creditors.typeTaxOffice": "Administration fiscale",
    "creditors.typeLeasingCompany": "Société de leasing",
    "creditors.typeEmployer": "Employeur",
    "creditors.typeBank": "Banque",
    "creditors.typeOther": "Autre",

    "nav.incomes": "Revenus",
    "incomes.title": "Revenus",
    "incomes.subtitle": "Salaires, primes, allocations, rentes, dividendes",
    "incomes.new": "Nouveau revenu",
    "incomes.edit": "Modifier le revenu",
    "incomes.name": "Nom",
    "incomes.type": "Type",
    "incomes.source": "Source / employeur",
    "incomes.card": "Compte de destination",
    "incomes.cycle": "Périodicité",
    "incomes.cycleInterval": "Intervalle",
    "incomes.nextExpected": "Prochain versement attendu",
    "incomes.currentAmount": "Montant net courant",
    "incomes.currency": "Devise",
    "incomes.status": "Statut",
    "incomes.startedOn": "Début",
    "incomes.endedOn": "Fin",
    "incomes.notes": "Notes",
    "incomes.statusActive": "Actif",
    "incomes.statusEnded": "Terminé",
    "incomes.deleteConfirm": "Ce revenu, son historique et les bulletins associés seront supprimés définitivement.",
    "incomes.created": "Revenu créé",
    "incomes.updated": "Revenu modifié",
    "incomes.deleted": "Revenu supprimé",
    "incomes.noIncomes": "Aucun revenu enregistré.",
    "incomes.monthlyTotal": "Revenu mensuel total",
    "incomes.showAmounts": "Afficher les montants",
    "incomes.hideAmounts": "Masquer les montants",
    "incomes.receipts": "Versements",
    "incomes.logReceipt": "Enregistrer un versement",
    "incomes.receivedOn": "Reçu le",
    "incomes.amount": "Montant net",
    "incomes.periodLabel": "Période",
    "incomes.payslipDetail": "Détail du bulletin",
    "incomes.grossAmount": "Brut",
    "incomes.socialCharges": "AVS / AI / APG",
    "incomes.pension": "2e pilier",
    "incomes.taxAtSource": "Impôt à la source",
    "incomes.otherDeductions": "Autres retenues",
    "incomes.bonus": "Prime / bonus",
    "incomes.deductionCheck": "Brut − retenues",
    "incomes.noReceipts": "Aucun versement enregistré.",
    "incomes.totalYTD": "Cumul versé",
    "incomes.attachments": "Bulletins de salaire",

    "incomes.type.salary": "Salaire",
    "incomes.type.bonus": "Prime / bonus",
    "incomes.type.thirteenth": "13e salaire",
    "incomes.type.pension": "Rente / pension",
    "incomes.type.unemployment": "Indemnités chômage",
    "incomes.type.family_allowance": "Allocations familiales",
    "incomes.type.dividend": "Dividendes",
    "incomes.type.rental": "Revenus locatifs",
    "incomes.type.gift": "Don / cadeau",
    "incomes.type.reimbursement": "Remboursement",
    "incomes.type.other": "Autre",
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

    "unlock.title": "TrackBuy",
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

    "nav.subscriptions": "Online subscriptions",
    "subscriptions.title": "Online subscriptions",
    "subscriptions.subtitle": "Streaming, SaaS, cloud, hosting, gaming",
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

    "nav.engagements": "Engagements",
    "nav.creditors": "Creditors",
    "engagements.title": "Engagements",
    "engagements.subtitle": "Recurring real-world charges: insurance, rent, utilities, telecom, taxes",
    "engagements.new": "New engagement",
    "engagements.edit": "Edit engagement",
    "engagements.name": "Name",
    "engagements.type": "Category",
    "engagements.creditor": "Creditor",
    "engagements.card": "Payment method",
    "engagements.parent": "Parent engagement",
    "engagements.contractRef": "Contract / policy number",
    "engagements.contractStart": "Contract start",
    "engagements.contractEnd": "Contract end",
    "engagements.noticePeriod": "Notice period (days)",
    "engagements.billingCycle": "Billing cycle",
    "engagements.cycleInterval": "Interval",
    "engagements.nextDue": "Next due",
    "engagements.currentAmount": "Current amount",
    "engagements.currency": "Currency",
    "engagements.paymentMethod": "Payment method",
    "engagements.autoPay": "Auto-pay",
    "engagements.status": "Status",
    "engagements.notes": "Notes",
    "engagements.clauses": "Clauses (free JSON)",
    "engagements.monthlyEquivalent": "Monthly equivalent",
    "engagements.totalMonthlyCost": "Total monthly cost",
    "engagements.noEngagements": "No engagements recorded yet.",
    "engagements.deleteConfirm": "This engagement, its charges, revisions and attachments will be permanently deleted.",
    "engagements.created": "Engagement created",
    "engagements.updated": "Engagement updated",
    "engagements.deleted": "Engagement deleted",
    "engagements.dueIn": "Due in",
    "engagements.statusActive": "Active",
    "engagements.statusSuspended": "Suspended",
    "engagements.statusEnded": "Ended",
    "engagements.cycleMonthly": "Monthly",
    "engagements.cycleQuarterly": "Quarterly",
    "engagements.cycleSemiannual": "Semiannual",
    "engagements.cycleYearly": "Yearly",
    "engagements.cycleOneShot": "One-shot",
    "engagements.cycleCustom": "Custom (days)",
    "engagements.methodDirectDebit": "Direct debit (LSV/SEPA)",
    "engagements.methodQrBill": "QR-bill",
    "engagements.methodBvr": "BVR",
    "engagements.methodManualTransfer": "Manual transfer",
    "engagements.methodStandingOrder": "Standing order",
    "engagements.methodCash": "Cash",
    "engagements.methodCardAuto": "Card (auto)",
    "engagements.methodOther": "Other",
    "engagements.children": "Sub-engagements",
    "engagements.addChild": "Add a sub-engagement",
    "engagements.revisions": "Contract revisions",
    "engagements.addRevision": "Add a revision",
    "engagements.charges": "Charges",
    "engagements.addCharge": "Add a charge",
    "engagements.markPaid": "Mark paid",
    "engagements.tabOverview": "Overview",
    "engagements.tabCharges": "Charges",
    "engagements.tabRevisions": "Revisions",
    "engagements.tabAttachments": "Attachments",
    "engagements.tabChildren": "Sub-engagements",
    "engagements.allCategories": "All",
    "engagements.catInsurance": "Insurance",
    "engagements.catHousing": "Housing",
    "engagements.catVehicle": "Vehicle",
    "engagements.catUtilities": "Utilities",
    "engagements.catTelecom": "Telecom",
    "engagements.catTaxes": "Taxes",
    "engagements.catOther": "Other",

    "engagements.type.insurance_health": "Health insurance",
    "engagements.type.insurance_household": "Household liability insurance",
    "engagements.type.insurance_car": "Car insurance",
    "engagements.type.insurance_life": "Life insurance",
    "engagements.type.insurance_legal": "Legal protection",
    "engagements.type.insurance_other": "Other insurance",
    "engagements.type.rent": "Rent",
    "engagements.type.parking": "Parking spot",
    "engagements.type.leasing": "Leasing",
    "engagements.type.mortgage": "Mortgage",
    "engagements.type.electricity": "Electricity",
    "engagements.type.gas": "Gas",
    "engagements.type.water": "Water",
    "engagements.type.fuel": "Fuel / charging",
    "engagements.type.heating": "Heating",
    "engagements.type.phone": "Phone",
    "engagements.type.internet": "Internet",
    "engagements.type.tv_radio": "TV / radio licence",
    "engagements.type.tax_federal": "Federal tax",
    "engagements.type.tax_cantonal": "Cantonal tax",
    "engagements.type.tax_communal": "Communal tax",
    "engagements.type.tax_other": "Other tax",
    "engagements.type.fine": "Fine",
    "engagements.type.fee": "Administrative fee",
    "engagements.type.membership": "Membership",
    "engagements.type.other": "Other",

    "charges.dueDate": "Due date",
    "charges.amount": "Amount",
    "charges.periodStart": "Period start",
    "charges.periodEnd": "Period end",
    "charges.quantity": "Quantity",
    "charges.unit": "Unit",
    "charges.unitPrice": "Unit price",
    "charges.reference": "BVR / QR reference",
    "charges.invoiceNumber": "Invoice number",
    "charges.paidOn": "Paid on",
    "charges.statusScheduled": "Scheduled",
    "charges.statusPaid": "Paid",
    "charges.statusLate": "Late",
    "charges.statusDisputed": "Disputed",
    "charges.statusWaived": "Waived",
    "charges.noCharges": "No charges yet.",

    "revisions.effectiveDate": "Effective date",
    "revisions.amount": "New amount",
    "revisions.changeReason": "Reason",
    "revisions.noRevisions": "No revisions recorded.",

    "creditors.title": "Creditors",
    "creditors.subtitle": "Insurers, landlords, utilities, tax offices",
    "creditors.new": "New creditor",
    "creditors.name": "Name",
    "creditors.type": "Type",
    "creditors.iban": "IBAN",
    "creditors.referencePrefix": "BVR reference prefix",
    "creditors.contactEmail": "Email",
    "creditors.contactPhone": "Phone",
    "creditors.address": "Address",
    "creditors.notes": "Notes",
    "creditors.typeInsurer": "Insurer",
    "creditors.typeLandlord": "Landlord",
    "creditors.typeUtility": "Utility",
    "creditors.typeTelco": "Telco",
    "creditors.typeTaxOffice": "Tax office",
    "creditors.typeLeasingCompany": "Leasing company",
    "creditors.typeEmployer": "Employer",
    "creditors.typeBank": "Bank",
    "creditors.typeOther": "Other",

    "nav.incomes": "Incomes",
    "incomes.title": "Incomes",
    "incomes.subtitle": "Salaries, bonuses, allowances, pensions, dividends",
    "incomes.new": "New income",
    "incomes.edit": "Edit income",
    "incomes.name": "Name",
    "incomes.type": "Type",
    "incomes.source": "Source / employer",
    "incomes.card": "Destination account",
    "incomes.cycle": "Frequency",
    "incomes.cycleInterval": "Interval",
    "incomes.nextExpected": "Next expected receipt",
    "incomes.currentAmount": "Current net amount",
    "incomes.currency": "Currency",
    "incomes.status": "Status",
    "incomes.startedOn": "Started",
    "incomes.endedOn": "Ended",
    "incomes.notes": "Notes",
    "incomes.statusActive": "Active",
    "incomes.statusEnded": "Ended",
    "incomes.deleteConfirm": "This income, its history and the associated payslips will be permanently deleted.",
    "incomes.created": "Income created",
    "incomes.updated": "Income updated",
    "incomes.deleted": "Income deleted",
    "incomes.noIncomes": "No income recorded yet.",
    "incomes.monthlyTotal": "Total monthly income",
    "incomes.showAmounts": "Show amounts",
    "incomes.hideAmounts": "Hide amounts",
    "incomes.receipts": "Receipts",
    "incomes.logReceipt": "Log a receipt",
    "incomes.receivedOn": "Received on",
    "incomes.amount": "Net amount",
    "incomes.periodLabel": "Period",
    "incomes.payslipDetail": "Payslip detail",
    "incomes.grossAmount": "Gross",
    "incomes.socialCharges": "Social charges (AVS/AI)",
    "incomes.pension": "Pension (2nd pillar)",
    "incomes.taxAtSource": "Tax at source",
    "incomes.otherDeductions": "Other deductions",
    "incomes.bonus": "Bonus",
    "incomes.deductionCheck": "Gross − deductions",
    "incomes.noReceipts": "No receipts recorded.",
    "incomes.totalYTD": "YTD total",
    "incomes.attachments": "Payslips",

    "incomes.type.salary": "Salary",
    "incomes.type.bonus": "Bonus",
    "incomes.type.thirteenth": "13th month",
    "incomes.type.pension": "Pension",
    "incomes.type.unemployment": "Unemployment",
    "incomes.type.family_allowance": "Family allowance",
    "incomes.type.dividend": "Dividends",
    "incomes.type.rental": "Rental income",
    "incomes.type.gift": "Gift",
    "incomes.type.reimbursement": "Reimbursement",
    "incomes.type.other": "Other",
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
