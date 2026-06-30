import cx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import {
  type ComponentType,
  createContext,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { type Option as AppOption, OPTION_SEPARATOR } from '../components/ui/AppProperties';

interface ContextMenuProviderProps {
  children: ReactNode;
}

interface ContextMenuCustomProps {
  hideContextMenu: () => void;
  [key: string]: unknown;
}

interface ContextMenuOption extends Omit<AppOption, 'customComponent' | 'customProps' | 'submenu'> {
  customComponent?: ComponentType<ContextMenuCustomProps>;
  customProps?: Record<string, unknown>;
  submenu?: ContextMenuOption[];
}

interface MenuState {
  isVisible: boolean;
  options: ContextMenuOption[];
  x: number;
  y: number;
}

interface SubMenuStyle {
  left?: string;
  opacity: number;
  top?: string;
}

interface ContextMenuValue {
  activeSubmenu: number[] | null;
  cancelCloseSubmenu: () => void;
  closeSubmenu: (path: number[]) => void;
  focusMenuItem: (path: number[]) => void;
  hideContextMenu: () => void;
  menuId: number;
  menuRef: RefObject<HTMLDivElement | null>;
  menuState: MenuState;
  openSubmenu: (path: number[] | null) => void;
  showContextMenu: (x: number, y: number, options: AppOption[]) => void;
}

interface MenuItemProps {
  hideContextMenu: () => void;
  path: number[];
  option: ContextMenuOption;
}

interface SubMenuProps {
  cancelCloseSubmenu: () => void;
  closeSubmenu: (path: number[]) => void;
  hideContextMenu: () => void;
  options: Array<ContextMenuOption>;
  parentRef: RefObject<HTMLElement | null>;
  parentPath: number[];
}

const ContextMenuContext = createContext<ContextMenuValue | undefined>(undefined);
const cssPx = (value: number): string => `${String(value)}px`;
const svgNumber = (value: number): string => String(value);
const menuPath = (path: number[]): string => path.join('-');
const afterMenuRender = (callback: () => void): void => {
  window.setTimeout(callback, 0);
};
const focusMenuItemByPath = (path: number[]): boolean => {
  const item = document.querySelector<HTMLButtonElement>(`[data-menu-item-path="${menuPath(path)}"]`);
  item?.focus();
  return Boolean(item);
};

const focusFirstMenuItem = (root: ParentNode | null): void => {
  const firstItem = root?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])');
  firstItem?.focus();
};

const firstEnabledOptionPath = (
  options: Array<ContextMenuOption> | undefined,
  parentPath: number[],
): number[] | null => {
  const index = options?.findIndex((option) => option.type !== OPTION_SEPARATOR && !option.disabled) ?? -1;
  return index >= 0 ? [...parentPath, index] : null;
};

export const useContextMenu = (): ContextMenuValue => {
  const value = useContext(ContextMenuContext);
  if (!value) {
    throw new Error('useContextMenu must be used within a ContextMenuProvider');
  }
  return value;
};

function SubMenu({ cancelCloseSubmenu, closeSubmenu, hideContextMenu, options, parentRef, parentPath }: SubMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<SubMenuStyle>({ opacity: 0 });
  const [safeAreaPath, setSafeAreaPath] = useState<string | null>(null);

  const firstOption = options[0];
  const customOption = options.length === 1 && firstOption?.customComponent ? firstOption : null;
  const CustomComponent = customOption?.customComponent;
  const isInteractiveSubmenu = Boolean(customOption);

  useLayoutEffect(() => {
    if (parentRef.current && menuRef.current) {
      const parentRect = parentRef.current.getBoundingClientRect();
      const menuEl = menuRef.current;

      const subMenuWidth = menuEl.offsetWidth || 256;
      const subMenuHeight = menuEl.offsetHeight || 100;

      if (subMenuWidth === 0 || subMenuHeight === 0) {
        return;
      }

      let top = parentRect.top;
      let left = parentRect.right - 4;

      if (left + subMenuWidth > window.innerWidth) {
        left = parentRect.left - subMenuWidth + 4;
      }
      if (left < 0) {
        left = 5;
      }

      if (top + subMenuHeight > window.innerHeight) {
        top = window.innerHeight - subMenuHeight - 5;
      }
      if (top < 0) {
        top = 5;
      }

      setStyle({ top: cssPx(top), left: cssPx(left), opacity: 1 });

      const isRightSide = left >= parentRect.right - 10;
      const path = isRightSide
        ? `
          M ${svgNumber(parentRect.right)} ${svgNumber(parentRect.top)}
          L ${svgNumber(left)} ${svgNumber(top)}
          L ${svgNumber(left)} ${svgNumber(top + subMenuHeight)}
          L ${svgNumber(parentRect.right)} ${svgNumber(parentRect.bottom)}
          Z
        `
        : `
          M ${svgNumber(parentRect.left)} ${svgNumber(parentRect.top)}
          L ${svgNumber(left + subMenuWidth)} ${svgNumber(top)}
          L ${svgNumber(left + subMenuWidth)} ${svgNumber(top + subMenuHeight)}
          L ${svgNumber(parentRect.left)} ${svgNumber(parentRect.bottom)}
          Z
        `;
      setSafeAreaPath(path);
    }
  }, [parentRef, options]);

  const menuMarkup = (
    <>
      {safeAreaPath && (
        <svg
          className="fixed top-0 left-0 w-full h-full pointer-events-none z-100"
          style={{ width: '100vw', height: '100vh' }}
        >
          <path
            d={safeAreaPath}
            fill="transparent"
            className="pointer-events-auto cursor-default"
            onMouseEnter={cancelCloseSubmenu}
          />
        </svg>
      )}

      <motion.div
        animate={{ opacity: 1, scale: 1 }}
        className="fixed z-101"
        exit={{ opacity: 0, scale: 0.95 }}
        initial={{ opacity: 0, scale: 0.95 }}
        onContextMenu={(e: ReactMouseEvent<HTMLDivElement>) => {
          e.preventDefault();
        }}
        onMouseEnter={cancelCloseSubmenu}
        onMouseLeave={() => {
          if (!isInteractiveSubmenu) {
            closeSubmenu(parentPath);
          }
        }}
        ref={menuRef}
        style={style}
        transition={{ duration: 0.1, ease: 'easeOut' }}
      >
        <div
          className={cx('backdrop-blur-md rounded-lg shadow-xl', !CustomComponent && 'bg-surface/95 p-2 w-56')}
          role="menu"
        >
          {CustomComponent ? (
            <CustomComponent {...customOption.customProps} hideContextMenu={hideContextMenu} />
          ) : (
            options.map((option, index) => (
              <MenuItem hideContextMenu={hideContextMenu} key={index} option={option} path={[...parentPath, index]} />
            ))
          )}
        </div>
      </motion.div>
    </>
  );

  return createPortal(menuMarkup, document.body);
}

function MenuItem({ option, path, hideContextMenu }: MenuItemProps) {
  const { activeSubmenu, openSubmenu, closeSubmenu, cancelCloseSubmenu, focusMenuItem } = useContextMenu();
  const itemRef = useRef<HTMLButtonElement | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstSubmenuOption = option.submenu?.[0];
  const hasInteractiveSubmenu = Boolean(option.submenu?.length === 1 && firstSubmenuOption?.customComponent);

  const submenuOptions = option.submenu;
  const isSubmenuOpen = Boolean(
    submenuOptions &&
      activeSubmenu &&
      activeSubmenu.length >= path.length &&
      path.every((val, i) => val === activeSubmenu[i]),
  );

  const handleMouseEnter = () => {
    cancelCloseSubmenu();
    if (!option.disabled) {
      itemRef.current?.focus();
    }
    hoverTimeoutRef.current = setTimeout(() => {
      if (option.disabled) {
        const parentPath = path.slice(0, -1);
        openSubmenu(parentPath.length > 0 ? parentPath : null);
        return;
      }
      if (option.submenu) {
        openSubmenu(path);
      } else {
        const parentPath = path.slice(0, -1);
        openSubmenu(parentPath.length > 0 ? parentPath : null);
      }
    }, 150);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    if (option.submenu && !option.disabled && !hasInteractiveSubmenu) {
      closeSubmenu(path);
    }
  };

  const focusSibling = (direction: 1 | -1) => {
    const currentItem = itemRef.current;
    const currentMenu = currentItem?.closest('[role="menu"]');
    if (!currentMenu) {
      return;
    }

    const items = Array.from(currentMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])'));
    if (!currentItem) {
      items[0]?.focus();
      return;
    }

    const currentIndex = items.indexOf(currentItem);
    if (currentIndex < 0 || items.length === 0) {
      return;
    }

    const nextIndex = (currentIndex + direction + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  const openKeyboardSubmenu = () => {
    if (!option.submenu || option.disabled) {
      return;
    }

    openSubmenu(path);
    afterMenuRender(() => {
      const firstChildPath = firstEnabledOptionPath(option.submenu, path);
      if (firstChildPath) {
        focusMenuItem(firstChildPath);
        return;
      }

      const submenu = itemRef.current?.parentElement?.querySelector<HTMLElement>('[role="menu"]');
      focusFirstMenuItem(submenu ?? null);
    });
  };

  const activateMenuItem = () => {
    if (option.disabled) {
      return;
    }

    if (option.submenu) {
      openKeyboardSubmenu();
      return;
    }

    option.onClick?.();
    hideContextMenu();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusSibling(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusSibling(-1);
        break;
      case 'Home': {
        event.preventDefault();
        const currentMenu = itemRef.current?.closest('[role="menu"]');
        focusFirstMenuItem(currentMenu ?? null);
        break;
      }
      case 'End': {
        event.preventDefault();
        const currentMenu = itemRef.current?.closest('[role="menu"]');
        const items = Array.from(
          currentMenu?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [],
        );
        items.at(-1)?.focus();
        break;
      }
      case 'ArrowRight':
        if (option.submenu) {
          event.preventDefault();
          openKeyboardSubmenu();
        }
        break;
      case 'ArrowLeft':
        if (path.length > 1) {
          event.preventDefault();
          const parentPath = path.slice(0, -1);
          const grandparentPath = path.slice(0, -2);
          openSubmenu(grandparentPath.length > 0 ? grandparentPath : null);
          focusMenuItem(parentPath);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        activateMenuItem();
        break;
      case 'Escape':
        event.preventDefault();
        hideContextMenu();
        break;
      default:
        break;
    }
  };

  if (option.type === OPTION_SEPARATOR) {
    return <div className="h-px bg-text-secondary/20 my-1 mx-2" />;
  }

  return (
    <div onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} className="relative">
      <button
        className={`
          w-full text-left px-3 py-2 text-sm rounded-md flex items-center gap-3 justify-between
          transition-colors duration-150
          ${option.isDestructive ? 'text-red-400 hover:bg-red-500/20' : 'text-text-primary hover:bg-bg-primary'}
          ${option.disabled ? 'text-text-secondary bg-transparent cursor-not-allowed' : ''}
        `}
        disabled={option.disabled}
        aria-expanded={option.submenu ? isSubmenuOpen : undefined}
        aria-haspopup={option.submenu ? 'menu' : undefined}
        data-menu-item-path={menuPath(path)}
        onClick={() => {
          if (!option.disabled && !option.submenu && option.onClick) {
            option.onClick();
            hideContextMenu();
          }
          if (!option.disabled && option.submenu && hasInteractiveSubmenu) {
            openSubmenu(path);
          }
        }}
        onMouseDown={(event) => {
          if (event.button !== 2) return;
          event.preventDefault();
          event.stopPropagation();
          if (!option.disabled && !option.submenu && option.onRightClick) {
            option.onRightClick();
            hideContextMenu();
          }
        }}
        onKeyDown={handleKeyDown}
        ref={itemRef}
        role="menuitem"
        tabIndex={-1}
      >
        <div className="flex items-center gap-3">
          {option.color && <div className="w-3 h-3 rounded-full" style={{ backgroundColor: option.color }}></div>}
          {option.icon && <option.icon size={16} />}
          <span>{option.label}</span>
        </div>
        {option.submenu && <ChevronRight size={16} />}
      </button>

      <AnimatePresence>
        {isSubmenuOpen && (
          <SubMenu
            cancelCloseSubmenu={cancelCloseSubmenu}
            closeSubmenu={closeSubmenu}
            hideContextMenu={hideContextMenu}
            options={submenuOptions ?? []}
            parentRef={itemRef}
            parentPath={path}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ContextMenu() {
  const { menuState, hideContextMenu, menuRef, menuId } = useContextMenu();
  const { isVisible, x, y, options } = menuState;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          className="fixed z-50"
          exit={{ opacity: 0, scale: 0.95 }}
          initial={{ opacity: 0, scale: 0.95 }}
          key={menuId}
          onContextMenu={(e: ReactMouseEvent<HTMLDivElement>) => {
            e.preventDefault();
          }}
          ref={menuRef}
          style={{ top: y, left: x }}
          transition={{ duration: 0.1, ease: 'easeOut' }}
        >
          <div className="bg-surface/95 backdrop-blur-md rounded-lg shadow-xl p-2 w-64" role="menu">
            {options.map((option, index) => (
              <MenuItem hideContextMenu={hideContextMenu} key={index} option={option} path={[index]} />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ContextMenuProvider({ children }: ContextMenuProviderProps) {
  const [menuState, setMenuState] = useState<MenuState>({ isVisible: false, x: 0, y: 0, options: [] });
  const [activeSubmenu, setActiveSubmenu] = useState<number[] | null>(null);
  const [menuId, setMenuId] = useState<number>(0);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const submenuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showContextMenu = useCallback((x: number, y: number, options: AppOption[]) => {
    const contextOptions = options as ContextMenuOption[];
    const menuWidth = 256;
    const menuHeight = contextOptions.reduce((acc, opt) => acc + (opt.type === OPTION_SEPARATOR ? 9 : 40), 0) + 16;
    const adjustedX = x + menuWidth > window.innerWidth ? window.innerWidth - menuWidth - 10 : x;
    const adjustedY = y + menuHeight > window.innerHeight ? window.innerHeight - menuHeight - 10 : y;

    setMenuState({ isVisible: true, x: adjustedX, y: adjustedY, options: contextOptions });
    setMenuId((id) => id + 1);
    setActiveSubmenu(null);
  }, []);

  const focusMenuItem = useCallback((path: number[]) => {
    if (!focusMenuItemByPath(path)) {
      afterMenuRender(() => {
        focusMenuItemByPath(path);
      });
    }
  }, []);

  const hideContextMenu = useCallback(() => {
    setMenuState((prev) => ({ ...prev, isVisible: false }));
    setActiveSubmenu(null);
  }, []);

  const openSubmenu = useCallback((path: number[] | null) => {
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current);
    }
    setActiveSubmenu(path);
  }, []);

  const closeSubmenu = useCallback((path: number[]) => {
    submenuTimeoutRef.current = setTimeout(() => {
      setActiveSubmenu((currentActivePath) => {
        if (currentActivePath && currentActivePath.join('-').startsWith(path.join('-'))) {
          const parentPath = path.slice(0, -1);
          return parentPath.length > 0 ? parentPath : null;
        }
        return currentActivePath;
      });
    }, 200);
  }, []);

  const cancelCloseSubmenu = useCallback(() => {
    if (submenuTimeoutRef.current) {
      clearTimeout(submenuTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const { target } = event;
      const isClickInside =
        target instanceof Node &&
        Array.from(document.querySelectorAll('[role="menu"]')).some((menuEl) => menuEl.contains(target));

      if (!isClickInside) {
        hideContextMenu();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        hideContextMenu();
      }
    };

    if (menuState.isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('scroll', hideContextMenu, true);
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', hideContextMenu, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuState.isVisible, hideContextMenu]);

  useEffect(() => {
    if (!menuState.isVisible) {
      return;
    }

    afterMenuRender(() => {
      const firstPath = firstEnabledOptionPath(menuState.options, []);
      if (firstPath) {
        focusMenuItem(firstPath);
      } else {
        focusFirstMenuItem(menuRef.current);
      }
    });
  }, [focusMenuItem, menuId, menuState.isVisible, menuState.options, menuRef]);

  const value: ContextMenuValue = {
    activeSubmenu,
    cancelCloseSubmenu,
    closeSubmenu,
    focusMenuItem,
    hideContextMenu,
    menuId,
    menuRef,
    menuState,
    openSubmenu,
    showContextMenu,
  };

  return (
    <ContextMenuContext.Provider value={value}>
      {children}
      <ContextMenu />
    </ContextMenuContext.Provider>
  );
}
