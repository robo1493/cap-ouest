// Rattrapage d'un retard : propositions de coupures, choisies ensuite par l'utilisateur
// selon ses réservations.
// - « skip »  : sauter un arrêt de transit (boondock d'une nuit) quand les deux journées de route
//               qui l'entourent tiennent en une seule au rythme choisi (km/jour)
// - « short » : raccourcir d'une nuit un séjour de 2 nuits ou plus (camping, parc)
// Les étapes qui portent un jalon de date ne sont jamais sautées.

const hasMilestone = s => !!(s.extra?.by || s.extra?.from);

// steps : étapes du voyage ; legs[i] : tronçon de steps[i] à steps[i+1] ({ km, provider })
// from  : index de l'étape où l'on se trouve (les coupures ne touchent que ce qui suit)
export function proposals(steps, legs, from, maxKmDay) {
  const out = [];
  // Arrêts de transit : on cumule la route depuis le dernier arrêt gardé
  let carried = 0;
  for (let k = from + 1; k < steps.length - 1; k++) {
    const s = steps[k], before = legs[k - 1], after = legs[k];
    if (!before || !after) { carried = 0; continue; }
    const transit = s.type === 'b' && s.nights === 1 && !hasMilestone(s)
      && before.provider !== 'ferry' && after.provider !== 'ferry';
    const day = carried + before.km + after.km;
    if (transit && day <= maxKmDay) {
      out.push({ id: `skip:${s.id}`, kind: 'skip', stepId: s.id, saves: 1, km: day,
        label: `Sauter ${s.name.split(',')[0]} : ${steps[k - 1].name.split(',')[0]} → ${steps[k + 1].name.split(',')[0]} en une journée (${Math.round(day)} km)` });
      carried += before.km;   // si l'arrêt suivant saute aussi, la journée s'allonge d'autant
    } else {
      carried = 0;
    }
  }
  // Séjours raccourcis d'une nuit
  for (let k = from + 1; k < steps.length; k++) {
    const s = steps[k];
    if (s.type === 'c' && s.nights >= 2) {
      out.push({ id: `short:${s.id}`, kind: 'short', stepId: s.id, saves: 1,
        label: `Raccourcir ${s.name.split(',')[0]} : ${s.nights} → ${s.nights - 1} nuits` });
    }
  }
  return out;
}

// Copie des étapes avec le retard ajouté à l'étape « from » et les coupures choisies appliquées
export function simulate(steps, from, delayDays, chosen) {
  const skip = new Set(chosen.filter(c => c.kind === 'skip').map(c => c.stepId));
  const short = new Set(chosen.filter(c => c.kind === 'short').map(c => c.stepId));
  return steps
    .map((s, i) => ({ ...s, nights: s.nights + (i === from ? delayDays : 0) - (short.has(s.id) ? 1 : 0) }))
    .filter(s => !skip.has(s.id));
}
