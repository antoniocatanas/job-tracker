// Applies the saved theme before the page draws, so there is no flash.
// "auto" follows the device's light/dark setting.
(function () {
  var t = 'auto';
  try { t = localStorage.getItem('theme') || 'auto'; } catch (e) {}
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
})();
