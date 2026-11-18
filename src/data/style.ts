/** Art-direction constants for the apartment (YooWorld identity: warm pastels, readable shapes). */
export const S = 1.2;            // Kenney Furniture Kit scale (kit wall 1.29 u -> 1.55 m)
export const TILE = 1 * S;       // wall tile width
export const WALL_H = 1.55;      // wall height in metres (kit wall 1.29 u x S)
export const BACK_WALL = ['wall', 'wallWindow', 'wallWindow', 'wall', 'wallDoorway', 'wall'];
export const LEFT_WALL = ['wall', 'wallWindow', 'wall', 'wall', 'wall'];
// Material palette override (the kit shares material names)
export const PALETTE: Record<string, string> = {
  carpet: '#e58fb0', carpetDarker: '#b9658a', carpetWhite: '#fff6f0', wood: '#d9a273', woodDark: '#9c6a48',
  _defaultMat: '#f7e7d6', metal: '#cfd6e6', metalLight: '#f4f1ee', metalDark: '#53506a', plant: '#5cc28f',
};
