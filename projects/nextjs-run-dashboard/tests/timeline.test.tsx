import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Timeline } from '../components/timeline';
it('shows step status, duration and screenshot with an accessible label', () => {
 render(<Timeline steps={[{id:1,position:1,name:'Open page',status:'failed',duration_ms:450, screenshot_url:'/screenshots/example.svg',error:'Timed out'}]} />);
 expect(screen.getByText('Open page')).toBeInTheDocument();
 expect(screen.getByText('Timed out')).toBeInTheDocument();
 expect(screen.getByAltText('Screenshot for Open page')).toBeInTheDocument();
});
