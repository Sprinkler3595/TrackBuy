import type { VehicleCategory, VehicleEnergyType, VehicleExpenseCategory } from "@/lib/tauri"

// Vehicle categories (shared with the insurance wizard) with FR/EN labels.
export const VEHICLE_CATEGORIES: { slug: VehicleCategory; fr: string; en: string }[] = [
  { slug: "passenger_car", fr: "Voiture de tourisme", en: "Passenger car" },
  { slug: "motorcycle", fr: "Motocycle", en: "Motorcycle" },
  { slug: "light_commercial", fr: "Utilitaire léger", en: "Light commercial" },
  { slug: "motorhome", fr: "Camping-car", en: "Motorhome" },
  { slug: "other", fr: "Autre", en: "Other" },
]

export const VEHICLE_ENERGY_TYPES: { slug: VehicleEnergyType; fr: string; en: string }[] = [
  { slug: "electric", fr: "Électrique", en: "Electric" },
  { slug: "gasoline", fr: "Essence", en: "Gasoline" },
  { slug: "diesel", fr: "Diesel", en: "Diesel" },
  { slug: "hybrid", fr: "Hybride", en: "Hybrid" },
  { slug: "phev", fr: "Hybride rechargeable", en: "Plug-in hybrid" },
  { slug: "other", fr: "Autre", en: "Other" },
]

// Swiss cantons — used for the (manual) vehicle-tax context.
export const CANTONS = ["VD", "GE", "VS", "FR", "NE", "JU", "BE", "ZH", "BS", "BL", "AG", "SO", "LU", "ZG", "SG", "TI", "GR", "TG", "SH", "AR", "AI", "GL", "NW", "OW", "SZ", "UR"]

export const energyLabel = (slug: VehicleEnergyType | null, fr: boolean): string =>
  VEHICLE_ENERGY_TYPES.find((e) => e.slug === slug)?.[fr ? "fr" : "en"] ?? ""

export const categoryLabel = (slug: VehicleCategory | null, fr: boolean): string =>
  VEHICLE_CATEGORIES.find((c) => c.slug === slug)?.[fr ? "fr" : "en"] ?? ""

export const isElectric = (t: VehicleEnergyType | null | undefined): boolean =>
  t === "electric" || t === "phev" || t === "hybrid"

// Vehicle expense categories, ordered for the picker. Charging & fuel carry a
// quantity (kWh / litres); the rest are plain amounts.
export const VEHICLE_EXPENSE_CATEGORIES: { slug: VehicleExpenseCategory; fr: string; en: string }[] = [
  { slug: "charging", fr: "Recharge (kWh)", en: "Charging (kWh)" },
  { slug: "fuel", fr: "Carburant", en: "Fuel" },
  { slug: "tires", fr: "Pneus", en: "Tires" },
  { slug: "maintenance", fr: "Entretien / service", en: "Maintenance / service" },
  { slug: "repair", fr: "Réparation", en: "Repair" },
  { slug: "cleaning", fr: "Nettoyage / lavage", en: "Cleaning / wash" },
  { slug: "accessories", fr: "Accessoires", en: "Accessories" },
  { slug: "inspection", fr: "Contrôle technique / expertise", en: "Inspection" },
  { slug: "vignette", fr: "Vignette", en: "Vignette" },
  { slug: "parking", fr: "Parking", en: "Parking" },
  { slug: "fine", fr: "Amende", en: "Fine" },
  { slug: "toll", fr: "Péage", en: "Toll" },
  { slug: "tax", fr: "Taxe / impôt véhicule", en: "Vehicle tax" },
  { slug: "other", fr: "Autre", en: "Other" },
]

export const expenseCategoryLabel = (slug: VehicleExpenseCategory, fr: boolean): string =>
  VEHICLE_EXPENSE_CATEGORIES.find((c) => c.slug === slug)?.[fr ? "fr" : "en"] ?? slug

/// Unit tied to a quantity-based category ("kWh" for charging, "l" for fuel).
/// null when the category doesn't track a quantity.
export const categoryUnit = (slug: VehicleExpenseCategory): string | null =>
  slug === "charging" ? "kWh" : slug === "fuel" ? "l" : null
