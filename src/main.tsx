import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles.css';
import { installViewportFill } from './app/viewportFill';
installViewportFill();
createRoot(document.getElementById('root')!).render(<App />);
