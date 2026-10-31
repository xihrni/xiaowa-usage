const REPO = 'xihrni/xiaowa-usage';
const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const OSS_BASE = 'https://xiaowa-xihrni-com.oss-cn-shenzhen.aliyuncs.com/stable';

const menuButton = document.querySelector('#menuButton');
const navLinks = document.querySelector('#navLinks');
menuButton?.addEventListener('click', () => {
  const open = navLinks.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(open));
});
navLinks?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
  navLinks.classList.remove('open');
  menuButton?.setAttribute('aria-expanded', 'false');
}));

async function loadLatestRelease() {
  try {
    const response = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) return;
    const release = await response.json();
    const version = release.tag_name || 'v0.1.0';
    const setup = release.assets?.find(asset => /Setup.*\.exe$/i.test(asset.name));
    const portable = release.assets?.find(asset => /win-x64\.zip$/i.test(asset.name));
    document.querySelectorAll('[data-latest-version]').forEach(node => { node.textContent = version; });
    document.querySelectorAll('[data-download-main]').forEach(node => {
      node.href = setup ? `${OSS_BASE}/${encodeURIComponent(setup.name)}` : (release.html_url || RELEASES_URL);
    });
    document.querySelectorAll('[data-download-portable]').forEach(node => {
      node.href = portable ? `${OSS_BASE}/${encodeURIComponent(portable.name)}` : (release.html_url || RELEASES_URL);
    });
    document.querySelectorAll('[data-download-github]').forEach(node => {
      node.href = setup?.browser_download_url || release.html_url || RELEASES_URL;
    });
  } catch {
    document.querySelectorAll('[data-download-main], [data-download-portable]').forEach(node => {
      node.href = RELEASES_URL;
    });
  }
}

loadLatestRelease();
