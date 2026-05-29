import type { Item } from "./tauri"

export function itemsToCsv(items: Item[]): string {
  const headers = [
    "Description",
    "Date d'achat",
    "Prix",
    "Devise",
    "Statut",
    "Marchand",
    "Lieu",
    "Carte",
    "Notes",
    "N° facture",
    "Réf. produit",
    "Quantité",
    "Prix HT",
    "Taux TVA",
  ]

  const escape = (val: string | null | undefined) => {
    if (!val) return ""
    if (val.includes(",") || val.includes('"') || val.includes("\n")) {
      return `"${val.replace(/"/g, '""')}"`
    }
    return val
  }

  const rows = items.map((item) =>
    [
      escape(item.description),
      item.purchase_date,
      item.purchase_price.toFixed(2),
      item.currency,
      item.status,
      escape(item.merchant_name),
      escape(item.location_name),
      escape(item.card_name),
      escape(item.notes),
      escape(item.invoice_number),
      escape(item.product_reference),
      String(item.quantity ?? 1),
      item.price_excl_tax != null ? item.price_excl_tax.toFixed(2) : "",
      item.tax_rate != null ? String(item.tax_rate) : "",
    ].join(",")
  )

  return [headers.join(","), ...rows].join("\n")
}

export function itemsToJson(items: Item[]): string {
  return JSON.stringify(
    items.map((item) => ({
      description: item.description,
      purchase_date: item.purchase_date,
      purchase_price: item.purchase_price,
      currency: item.currency,
      status: item.status,
      merchant: item.merchant_name,
      location: item.location_name,
      card: item.card_name,
      notes: item.notes,
      invoice_number: item.invoice_number,
      product_reference: item.product_reference,
      quantity: item.quantity,
      price_excl_tax: item.price_excl_tax,
      tax_rate: item.tax_rate,
    })),
    null,
    2
  )
}

export async function downloadExport(content: string, filename: string) {
  try {
    const { save } = await import("@tauri-apps/plugin-dialog")
    const { writeTextFile } = await import("./tauri")
    const destination = await save({
      defaultPath: filename,
      title: "Exporter les achats",
      filters: filename.endsWith(".csv")
        ? [{ name: "CSV", extensions: ["csv"] }]
        : [{ name: "JSON", extensions: ["json"] }],
    })
    if (destination) {
      await writeTextFile(destination, content)
      return true
    }
  } catch (e) {
    console.error("Export failed:", e)
  }
  return false
}
