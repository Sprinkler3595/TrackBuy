import { useState } from "react"
import { Link } from "react-router-dom"
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  HandCoins,
  Lightbulb,
  Repeat,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/// L'aide, écrite pour quelqu'un qui a sa fiche de salaire sous les yeux et pas
/// le vocabulaire de la prévoyance professionnelle.
///
/// Elle répond à deux questions et pas à une troisième. Comment enregistrer un
/// revenu, et — la question qui bloque vraiment — où aller CHERCHER les
/// chiffres du 2ᵉ pilier et de quoi on parle au juste. Elle n'explique pas la
/// LPP en général : ça, des sites entiers le font mieux. Elle dit quel document
/// ouvrir, à quelle rubrique, et quoi recopier où.
///
/// Le piège central est nommé deux fois plutôt qu'une : « 50/50 » décrit un
/// PARTAGE, pas un taux. C'est l'erreur qui a été commise en vrai, elle mérite
/// d'être signalée là où elle se produit.

function Section({
  icon: Icon,
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  icon: typeof HandCoins
  title: string
  subtitle: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 p-5 text-left"
      >
        <Chevron className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <span className="min-w-0">
          <span className="block text-base font-semibold">{title}</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{subtitle}</span>
        </span>
      </button>
      {open && <CardContent className="space-y-4 border-t pt-5 text-sm">{children}</CardContent>}
    </Card>
  )
}

/// Une étape numérotée. Le titre dit ce qu'on vous demande, le corps dit
/// pourquoi — sans le pourquoi, on remplit au hasard.
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
        {n}
      </span>
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{title}</p>
        <div className="space-y-1.5 text-muted-foreground">{children}</div>
      </div>
    </div>
  )
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <span>{children}</span>
    </p>
  )
}

function Tip({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 rounded-md border bg-muted/40 p-3 text-xs">
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{children}</span>
    </p>
  )
}

/// Un tableau qui tient sur un téléphone : la première colonne porte
/// l'information, les suivantes s'empilent en dessous sur écran étroit.
function Lookup({
  rows,
}: {
  rows: Array<{ what: string; where: string; looks: string }>
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="pb-2 pr-3 font-medium">Ce que l'app demande</th>
            <th className="pb-2 pr-3 font-medium">Où le lire</th>
            <th className="pb-2 font-medium">À quoi ça ressemble</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.what} className="align-top">
              <td className="py-2 pr-3 font-medium">{r.what}</td>
              <td className="py-2 pr-3 text-muted-foreground">{r.where}</td>
              <td className="py-2 text-muted-foreground">
                <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.looks}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function HelpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Aide</h2>
        <p className="text-muted-foreground">
          Enregistrer un salaire, et retrouver les chiffres qu'on vous demande.
        </p>
      </div>

      <Section
        icon={HandCoins}
        title="Enregistrer un salaire"
        subtitle="Cinq écrans courts, une seule fois. Ce qu'on vous demande et pourquoi."
        defaultOpen
      >
        <p className="text-muted-foreground">
          Depuis <strong>Revenus</strong>, bouton <strong>Nouveau revenu</strong>, puis
          « Salaire régulier ». Rien n'est définitif : tout se corrige depuis la fiche du
          revenu ensuite.
        </p>

        <div className="space-y-4">
          <Step n={1} title="L'entreprise">
            <p>
              Son nom, son numéro IDE (<code className="rounded bg-muted px-1 py-0.5">CHE-123.456.789</code>)
              et son adresse. L'IDE et l'adresse sont facultatifs : aucun calcul ne les
              utilise.
            </p>
            <p>
              L'entreprise est enregistrée une fois pour toutes. Elle sera proposée
              automatiquement pour vos primes et vos notes de frais.
            </p>
            <p>
              <strong>« Chercher au registre »</strong> évite de recopier l'IDE à la main :
              le nom suffit, et l'IDE comme l'adresse du <em>siège</em> viennent de Zefix,
              le registre officiel du commerce. Le siège compte : c'est lui, et non votre
              domicile, qui détermine les retenues sociales cantonales. Rien à régler — le
              registre est public. S'il refusait vos requêtes, le message vous renverra vers
              <strong> Paramètres → Registre du commerce</strong>, où se saisissent des
              identifiants gratuits obtenus à{" "}
              <code className="rounded bg-muted px-1 py-0.5">zefix@bj.admin.ch</code>. Les
              données du registre sont en libre usage à une condition, que l'écran de
              recherche remplit pour vous : en citer la source, l'Office fédéral du registre
              du commerce.
            </p>
          </Step>

          <Step n={2} title="Le contrat">
            <p>
              Le <strong>salaire brut annuel</strong> — celui écrit au contrat, avant toute
              retenue — et le nombre de paies (12 ou 13). L'app fait la division et vous
              montre le brut par paie.
            </p>
            <p>
              Puis la date de début, la date du prochain versement, les heures par semaine
              et le taux d'activité. Les heures servent à vérifier la majoration de 25 % sur
              vos heures supplémentaires (art. 321c al. 3 CO).
            </p>
            <p>
              Si vous ne connaissez pas vos taux, un lien permet de saisir directement le
              net que vous recevez. Aucune retenue ne sera calculée, mais le revenu existera.
            </p>
          </Step>

          <Step n={3} title="Les cotisations">
            <p>
              Votre canton, votre date de naissance, et trois taux propres à votre
              entreprise. Les retenues <strong>légales</strong> — AVS, assurance-chômage,
              retenues cantonales — sont affichées mais pas saisies : elles sont identiques
              pour tout le monde.
            </p>
            <p>
              Laissez vide ce que vous ne savez pas. L'app dira « net versé au maximum » et
              signalera la retenue comme non contrôlable, plutôt que d'inventer un chiffre.
            </p>
          </Step>

          <Step n={4} title="Les documents">
            <p>Votre contrat de travail, en pièce jointe. Facultatif, mais c'est le moment.</p>
          </Step>

          <Step n={5} title="Complétez la fiche du revenu">
            <p>
              L'assistant reste volontairement court. L'onglet <strong>Contrat</strong> de la
              fiche accueille ensuite ce qui demande votre plan de prévoyance sous les yeux :
              le barème d'astreintes et de week-ends, et le plan du 2ᵉ pilier par tranches
              d'âge — voir la section suivante.
            </p>
          </Step>
        </div>

        <Tip>
          Vous reprenez un historique ? L'onglet <strong>Bulletins</strong> propose
          « Importer un lot » : déposez vos anciennes fiches en PDF, elles sont lues et
          contrôlées d'un coup. Un certificat de salaire annuel remplace douze fiches.
        </Tip>
      </Section>

      <Section
        icon={FileText}
        title="Le 2ᵉ pilier (LPP) — où trouver les chiffres"
        subtitle="Quel document ouvrir, à quelle rubrique, et quoi recopier."
      >
        <div className="space-y-1.5">
          <p className="font-medium">De quoi parle-t-on</p>
          <p className="text-muted-foreground">
            La cotisation au 2ᵉ pilier ne se calcule <strong>pas</strong> sur votre salaire
            brut, mais sur le <strong>salaire coordonné</strong> : votre salaire annuel moins
            une déduction fixe (26 460 CHF en 2026). C'est pour cela qu'un taux de 3,2 % ne
            représente en réalité que 2 % environ de votre brut.
          </p>
          <p className="text-muted-foreground">
            Ce taux monte par <strong>paliers d'âge</strong>, et chaque palier se partage
            entre vous et votre employeur — qui doit financer au moins autant que vous
            (art. 66 al. 1 LPP).
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="font-medium">Les trois documents, et ce que chacun donne</p>
          <ul className="ml-4 list-disc space-y-2 text-muted-foreground">
            <li>
              <strong>Le plan de prévoyance</strong> — le document clé, quelques pages,
              intitulé « Plan de prévoyance ». Il donne les taux par tranche d'âge et la
              définition du salaire assuré. Demandez-le aux RH, ou téléchargez-le depuis
              l'espace en ligne de votre caisse. C'est de LUI que vient tout ce que l'app
              demande.
            </li>
            <li>
              <strong>Le certificat de prévoyance</strong> — envoyé chaque année par la
              caisse. Il donne votre salaire assuré en francs et votre cotisation annuelle.
              Il sert à <em>vérifier</em> ce que vous avez saisi.
            </li>
            <li>
              <strong>Votre fiche de salaire</strong> — la retenue effective du mois, en
              francs. C'est ce que l'app compare à son calcul.
            </li>
          </ul>
        </div>

        <div className="space-y-2">
          <p className="font-medium">Où lire quoi</p>
          <Lookup
            rows={[
              {
                what: "Caisse de pension",
                where: "En-tête du plan ou du certificat",
                looks: "Columna Fondation collective Group Invest",
              },
              {
                what: "Tranches d'âge et total %",
                where: "Plan → « Bonifications de vieillesse » ou « contribution d'épargne »",
                looks: "20-34 : 8 %  ·  35-44 : 11 %",
              },
              {
                what: "Votre part %",
                where: "Plan → « Financement » → « Contribution d'épargne salarié »",
                looks: "20-34 : 3.2 %  ·  35-44 : 4.4 %",
              },
              {
                what: "Assiette du taux",
                where: "Plan → « Salaire » → définition du salaire assuré",
                looks: "salaire annuel moins déduction de coordination",
              },
              {
                what: "Déduction réduite au temps partiel",
                where: "Plan, juste sous la déduction de coordination",
                looks: "avec réduction … pour les salariés à temps partiel",
              },
              {
                what: "Date de naissance",
                where: "Vous — elle décide de la tranche applicable",
                looks: "1986-08-15",
              },
            ]}
          />
        </div>

        <Warning>
          <strong>Le piège à éviter.</strong> Votre caisse annonce souvent une « répartition
          50/50 », votre assureur une « prime partagée par moitié ». Ces phrases décrivent le{" "}
          <strong>partage</strong> entre l'employeur et vous — <strong>pas le taux</strong>.
          Saisir 50 donnerait une retenue une quinzaine de fois trop grosse. Votre part se
          situe d'ordinaire entre 3 et 9 % du salaire coordonné.
        </Warning>

        <div className="space-y-1.5">
          <p className="font-medium">Où le saisir dans l'app</p>
          <p className="text-muted-foreground">
            Fiche du revenu → onglet <strong>Contrat</strong> → carte{" "}
            <strong>Votre plan de prévoyance</strong>. Deux boutons pré-remplissent un plan
            type (minimum légal, ou AXA Columna « Standard ») ; corrigez ensuite avec votre
            document.
          </p>
          <p className="text-muted-foreground">
            Une fois saisi, l'app affiche votre part <strong>en francs par an</strong> et en{" "}
            <strong>% de votre brut</strong> — les deux chiffres qui manquent partout
            ailleurs. Comparez-les au certificat de prévoyance : ils doivent concorder.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="font-medium">Ce que l'app ne calcule pas</p>
          <p className="text-muted-foreground">
            Un plan facture aussi des <strong>primes de risque et des frais</strong>. Il en
            donne la clé de répartition, mais pas le taux — celui-ci vit sur la facture
            annuelle de la caisse. Votre retenue réelle sera donc un peu supérieure à
            l'épargne calculée ici. Si vous connaissez ce taux, ajoutez-le comme une tranche
            supplémentaire.
          </p>
        </div>

        <Tip>
          Avant 25 ans, la loi n'impose aucune épargne vieillesse — seuls les risques décès
          et invalidité sont couverts, dès 18 ans (art. 7 LPP). Beaucoup de caisses
          commencent plus tôt malgré tout : c'est un choix de votre employeur, et votre plan
          le dit.
        </Tip>
      </Section>

      <Section
        icon={FileText}
        title="Les autres taux de votre fiche"
        subtitle="AVS, chômage, LAA, indemnités journalières : lesquels saisir, lesquels non."
      >
        <div className="space-y-1.5">
          <p className="font-medium">Rien à saisir</p>
          <p className="text-muted-foreground">
            AVS/AI/APG, assurance-chômage et retenues cantonales sont fixées par la loi,
            identiques pour tout le monde. L'app les connaît et les affiche. Elles changent
            au 1ᵉʳ janvier ; si un chiffre vous paraît faux, il se corrige dans{" "}
            <Link to="/settings/baremes" className="underline underline-offset-2">
              Paramètres → Barèmes
            </Link>
            .
          </p>
        </div>

        <div className="space-y-2">
          <p className="font-medium">À saisir, depuis votre fiche de salaire</p>
          <Lookup
            rows={[
              {
                what: "Prime AANP (LAA)",
                where: "Fiche de salaire, colonne des déductions — accidents non professionnels",
                looks: "1.375 % du salaire assuré",
              },
              {
                what: "Prime IJM",
                where: "Fiche de salaire — indemnités journalières maladie",
                looks: "0.5 % du salaire assuré",
              },
              {
                what: "Impôt à la source",
                where: "Fiche de salaire — le barème (A0N, B2Y…) et le taux appliqué",
                looks: "A0N · 8.42 %",
              },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            Si votre fiche ne donne que des montants en francs et pas les taux, divisez le
            montant par votre brut du mois et multipliez par 100.
          </p>
        </div>

        <Tip>
          Les accidents <strong>professionnels</strong> sont payés par l'employeur
          (art. 91 LAA) : ils n'apparaissent jamais dans vos déductions. Seuls les accidents
          non professionnels sont à votre charge.
        </Tip>
      </Section>

      <Section
        icon={Repeat}
        title="Chaque mois, et quand les choses changent"
        subtitle="Confirmer un salaire reçu, enregistrer un avenant, déménager."
      >
        <div className="space-y-1.5">
          <p className="font-medium">Quand vous recevez votre salaire</p>
          <p className="text-muted-foreground">
            Fiche du revenu → onglet <strong>Bulletins</strong> →{" "}
            <strong>J'ai reçu mon salaire</strong>. Le décompte est déjà calculé depuis votre
            contrat : il ne reste qu'à le comparer à votre fiche.
          </p>
          <p className="text-muted-foreground">
            Ajoutez au brut ce qui est du salaire (astreintes, bonus, heures
            supplémentaires), et après les retenues ce qui n'en est pas (frais remboursés).
            Corrigez toute ligne qui diffère : c'est cet écart qui vaut d'être vu. Puis
            joignez la fiche originale.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="font-medium">Quand vos conditions changent</p>
          <p className="text-muted-foreground">
            Onglet <strong>Contrat</strong> → <strong>Annoncer un changement</strong>. Vaut
            pour tout : salaire renégocié, taux de cotisation revu, nouveau plan de
            prévoyance, entreprise qui change de nom ou d'IDE, déménagement, passage à temps
            partiel.
          </p>
          <p className="text-muted-foreground">
            Vous êtes guidé section par section : la date d'effet, l'entreprise, la
            rémunération, vos assurances, les frais, le régime fiscal. Les conditions
            actuelles sont reprises — ne changez que ce qui change. La dernière étape
            récapitule <strong>ce qui bouge</strong>, ligne par ligne, avant d'enregistrer.
          </p>
          <p className="text-muted-foreground">
            Vos bulletins antérieurs restent contrôlés avec les conditions de leur époque, et
            l'écran vous dit combien sont ainsi protégés. La version précédente se clôt toute
            seule à la veille de la date d'effet.
          </p>
          <p className="text-muted-foreground">
            <strong>Les conditions enregistrées sont en lecture seule.</strong> Un contrat
            signé ne se retouche pas : c'est ce qui garantit qu'une fiche validée l'an dernier
            le reste. Un lien discret, « Corriger une erreur de saisie », existe pour les
            fautes de frappe — il modifie la version sur place, sans trace de changement, et
            vous avertit lourdement si des bulletins en dépendent.
          </p>
          <p className="text-muted-foreground">
            Même verrou sur le plan de prévoyance et le barème d'astreintes : dès qu'une
            version juge des bulletins, ils se figent. Annoncez un changement — ils seront
            recopiés sur la nouvelle version, où vous pourrez les ajuster.
          </p>
          <p className="text-muted-foreground">
            Les taux <strong>légaux</strong> — AVS, chômage, cantonaux — ne dépendent pas de
            votre contrat : ils changent au 1ᵉʳ janvier et sont gérés par année dans{" "}
            <Link to="/settings/baremes" className="underline underline-offset-2">
              Paramètres → Barèmes
            </Link>
            . Vos anciens bulletins gardent automatiquement les barèmes de leur année.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="font-medium">Quand vous déménagez</p>
          <p className="text-muted-foreground">
            Deux cantons pilotent deux choses différentes. Le canton de{" "}
            <strong>travail</strong> (siège de l'employeur) commande les retenues sociales
            cantonales ; le canton de <strong>domicile</strong> commande le barème d'impôt à
            la source. Une case du formulaire de contrat ouvre le second champ quand ils
            diffèrent.
          </p>
        </div>

        <div className="space-y-1.5">
          <p className="font-medium">Quand vous quittez l'entreprise</p>
          <p className="text-muted-foreground">
            Fiche du revenu → <strong>Clore ce revenu</strong>, avec la date du dernier
            versement. Le revenu ne compte plus dans « Ce mois », mais ses bulletins restent
            dans votre historique de cotisations et sur la page{" "}
            <Link to="/incomes/carriere" className="underline underline-offset-2">
              Carrière
            </Link>
            .
          </p>
        </div>
      </Section>

      <p className={cn("text-xs text-muted-foreground")}>
        Cette aide décrit ce que l'application fait de vos chiffres. Elle ne remplace ni votre
        règlement de prévoyance, ni un conseil professionnel. En cas d'écart persistant entre
        un calcul et votre fiche de salaire, votre service RH ou votre caisse tranche.
      </p>
    </div>
  )
}
