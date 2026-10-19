import { store } from '../state/store.js';

export class SidebarFilters {
  constructor(container, onSelectRoom) {
    this.container = container;
    this.onSelectRoom = onSelectRoom;
    this.init();
  }

  init() {
    this.container.innerHTML = `
      <div class="left-sidebar">
        <button class="sidebar-close-btn" id="btn-collapse-sidebar" title="Ocultar panel">✕</button>
        
        <div class="sidebar-header">
          <svg class="sidebar-header-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1"/>
          </svg>
          <div class="sidebar-title">Habitaciones</div>
          <div class="toggle-row">
            <div class="umbra-switch on" id="toggle-show-rooms">
              <div class="umbra-switch-knob"></div>
            </div>
            <span class="toggle-label">Mostrar habitaciones</span>
          </div>
        </div>

        <div class="sidebar-body">
          <div class="filter-main-heading">
            <span>FILTRAR POR ATRIBUTOS:</span>
            <span>▼</span>
          </div>

          <!-- Sector / Ala -->
          <div class="filter-section">
            <div class="filter-section-label">Ala / Sector</div>
            <div class="filter-stack" id="wing-filters">
              <!-- Rendered dynamically -->
            </div>
          </div>

          <!-- Room list buttons -->
          <div class="filter-section">
            <div class="filter-section-label">Habitaciones Piso 2</div>
            <div class="filter-stack" id="room-list-buttons">
              <!-- Rendered dynamically -->
            </div>
          </div>

          <!-- Tipología -->
          <div class="filter-section">
            <div class="filter-section-label">Tipología</div>
            <div class="filter-grid-2" id="typology-filters">
              <!-- Rendered dynamically -->
            </div>
          </div>
        </div>

        <div class="sidebar-collapse-tab" id="sidebar-tab" title="Mostrar/Ocultar">
          ‹
        </div>
      </div>
    `;

    this.bindEvents();
    store.subscribe(() => this.render());
  }

  bindEvents() {
    const toggle = this.container.querySelector('#toggle-show-rooms');
    toggle.addEventListener('click', () => {
      const next = !store.state.showRoomsOverlay;
      toggle.classList.toggle('on', next);
      store.setState({ showRoomsOverlay: next });
    });

    const collapseBtn = this.container.querySelector('#btn-collapse-sidebar');
    const collapseTab = this.container.querySelector('#sidebar-tab');
    const toggleCollapse = () => {
      this.container.classList.toggle('collapsed');
      const isCollapsed = this.container.classList.contains('collapsed');
      collapseTab.textContent = isCollapsed ? '›' : '‹';
    };
    collapseBtn.addEventListener('click', toggleCollapse);
    collapseTab.addEventListener('click', toggleCollapse);
  }

  render() {
    const { rooms, activeWing, activeTypology, selectedRoomId } = store.state;
    if (!rooms || rooms.length === 0) return;

    // 1. Wings
    const wings = [...new Set(rooms.map(r => r.wing))];
    const wingContainer = this.container.querySelector('#wing-filters');
    wingContainer.innerHTML = `
      <button class="umbra-filter-btn ${!activeWing ? 'active-gray' : ''}" data-wing="">Todas las Alas</button>
      ${wings.map(w => `
        <button class="umbra-filter-btn ${activeWing === w ? 'active-gray' : ''}" data-wing="${w}">
          ${w}
        </button>
      `).join('')}
    `;

    wingContainer.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        const w = btn.dataset.wing || null;
        store.setState({ activeWing: w });
      };
    });

    // 2. Room buttons
    const filtered = store.getFilteredRooms();
    const roomContainer = this.container.querySelector('#room-list-buttons');
    roomContainer.innerHTML = filtered.map(r => `
      <button class="umbra-filter-btn ${selectedRoomId === r.id ? 'active-red' : ''}" data-id="${r.id}">
        Hab. ${r.number} · ${r.typology} (${r.areaPrivateM2} m²)
      </button>
    `).join('');

    roomContainer.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        this.onSelectRoom(id);
      };
    });

    // 3. Typologies
    const typologies = [...new Set(rooms.map(r => r.typology))];
    const typoContainer = this.container.querySelector('#typology-filters');
    typoContainer.innerHTML = `
      <button class="umbra-filter-btn ${!activeTypology ? 'active-gray' : ''}" data-typo="" style="grid-column: span 2">Todas</button>
      ${typologies.map(t => `
        <button class="umbra-filter-btn ${activeTypology === t ? 'active-gray' : ''}" data-typo="${t}">
          ${t}
        </button>
      `).join('')}
    `;

    typoContainer.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        const t = btn.dataset.typo || null;
        store.setState({ activeTypology: t });
      };
    });
  }
}
