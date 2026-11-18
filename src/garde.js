/* Garde-fou : si les modules ne se chargent pas (souvent un cache qui mélange d'anciens et de nouveaux fichiers), on le dit au lieu d'afficher une page blanche.
   Fichier séparé (et non script en ligne) pour pouvoir appliquer une politique de sécurité de contenu stricte. */
setTimeout(function () {
  if (document.documentElement.dataset.pret) return;
  var d = document.createElement('div');
  d.className = 'fr-alert fr-alert--error fr-m-2w';
  var t = document.createElement('p');
  t.className = 'fr-alert__title';
  t.textContent = "Le widget ne s'est pas chargé";
  var p = document.createElement('p');
  p.textContent = "Rechargez la page sans le cache (Ctrl+Maj+R) ; si le message revient, ouvrez la console du navigateur (F12) et transmettez l'erreur affichée.";
  d.append(t, p);
  document.body.prepend(d);
}, 5000);
